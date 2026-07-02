import { afterAll, describe, expect, it } from 'vitest';
import { readEnv } from '../src/lib/env';
import { createAdminClient } from '../src/lib/supabase/admin';
import { MockCore } from '../src/lib/adapters/mock-core';
import { MockPayments } from '../src/lib/adapters/mock-payments';
import { MockBooking } from '../src/lib/adapters/mock-booking';
import { MockVideo } from '../src/lib/adapters/mock-video';
import { getScreening } from '../src/lib/adapters/factory';
import { submitWeightIntake } from '../src/lib/weight/submit';
import type { WeightIntakeAnswers } from '../src/lib/intake/weight-routing';
import { startProductCheckout, finaliseTreatmentCheckout } from '../src/lib/checkout/checkout';
import { getProduct, PRODUCTS } from '../src/lib/checkout/products';
import { finaliseLatestPending } from '../src/lib/payments/billing';
import {
  attachScreeningResults,
  receiveScreeningSample,
  routeScreenedWeightPatient,
} from '../src/lib/screening/order';
import { glpInitiationRoute, glpRoutingFromEnv } from '../src/lib/weight/glp-routing';
import { startConsultBooking, finaliseLatestBooking } from '../src/lib/consult/booking';
import { decideConsultAction } from '../src/lib/clinician/consult';
import { ALLOWED_TRANSITIONS, RX_ISSUED_PREDECESSORS, canTransition } from '../src/lib/journey/machine';
import {
  ensureAccount,
  getJourney,
  getLatestBookingRef,
  getLatestCheckoutConsent,
  getLatestScreeningRef,
  hasPaidConsult,
  listPendingFastQueue,
  setCorePatientId,
  setJourney,
} from '../src/lib/accounts';

// ===========================================================================
// Checkout C3 — the consult checkout (Journey C, ~£100) on the shared surface,
// plus the GLP initiation routing switch (async base tier vs consult-mandatory).
//
// Proven here: paying the consult (test mode) gates the full-lane booking
// (consult_booked); the async base path is unaffected by default; the routing
// switch toggles cleanly; and the hard line is untouched — rx_issued stays
// reachable only from approved / consult_done, via a clinician action.
// ===========================================================================

const env = {
  ...readEnv(),
  CORE_IMPL: 'mock',
  SCREENING_IMPL: 'mock',
  PAYMENTS_IMPL: 'mock',
  BOOKING_IMPL: 'mock',
  VIDEO_IMPL: 'mock',
};
const admin = createAdminClient(env);
const core = new MockCore(admin);
const payments = new MockPayments(admin);
const booking = new MockBooking(admin);
const video = new MockVideo();
const screening = getScreening(env, admin);
const createdAccounts: string[] = [];

afterAll(async () => {
  if (createdAccounts.length === 0) return;
  await admin.from('mock_payment_session').delete().in('account_id', createdAccounts);
  await admin.from('mock_booking_session').delete().in('account_id', createdAccounts);
  await admin.from('checkout_consent').delete().in('account_id', createdAccounts);
  await admin.from('account').delete().in('id', createdAccounts);
});

function cleanWeightAnswers(over: Partial<WeightIntakeAnswers> = {}): WeightIntakeAnswers {
  return {
    bmi: 32,
    hasRelatedCondition: false,
    currentPregnancy: false,
    planningPregnancy: false,
    breastfeeding: false,
    eatingDisorderHistory: false,
    thyroidCancerHistory: false,
    pancreatitisHistory: false,
    ...over,
  };
}

async function freshClinician(): Promise<string> {
  const account = await ensureAccount(admin, crypto.randomUUID());
  createdAccounts.push(account.id);
  await admin.from('account').update({ role: 'clinician' }).eq('id', account.id);
  return account.id;
}

async function verifiedPatient(name: string): Promise<{ accountId: string; corePatientId: string }> {
  const account = await ensureAccount(admin, crypto.randomUUID());
  createdAccounts.push(account.id);
  const corePatientId = await core.createPatient({ fullName: name });
  await setCorePatientId(admin, account.id, corePatientId);
  await setJourney(admin, account.id, 'id_verified', null);
  return { accountId: account.id, corePatientId };
}

// Pay the consult via the SHARED checkout surface (Journey C descriptor -> the
// 'consult' payment kind), through the mock provider, then finalise.
async function payConsultViaCheckout(accountId: string): Promise<string> {
  const clientUrl = await startProductCheckout(
    admin,
    payments,
    PRODUCTS.consult,
    accountId,
    '/checkout/complete?product=consult',
  );
  const sessionId = new URL(clientUrl, 'https://x').searchParams.get('session')!;
  await payments.markPaid(sessionId);
  await finaliseLatestPending(admin, payments, accountId);
  return sessionId;
}

// Drive a mock booking to booked and finalise -> consult_booked.
async function bookConsult(accountId: string): Promise<void> {
  const clientUrl = await startConsultBooking(admin, booking, accountId, '/consult/book/complete');
  const bookingId = new URL(clientUrl, 'https://x').searchParams.get('booking')!;
  await booking.markBooked(bookingId, new Date('2026-07-20T09:00:00.000Z').toISOString());
  await finaliseLatestBooking(admin, booking, video, accountId);
}

// A screened weight patient with the bloods in (results_ready) + a paid pay-first
// treatment charge, ready for the GLP routing switch.
async function screenedWeightPatient() {
  const { accountId, corePatientId } = await verifiedPatient('C3 Weight Patient');
  await submitWeightIntake(admin, core, screening, accountId, corePatientId, cleanWeightAnswers(), {
    orderKit: false,
  });
  // Pay-first treatment -> screening kit ordered (the C2 gate).
  const clientUrl = await startProductCheckout(
    admin,
    payments,
    PRODUCTS.weight_treatment,
    accountId,
    '/r',
  );
  const sessionId = new URL(clientUrl, 'https://x').searchParams.get('session')!;
  await payments.markPaid(sessionId);
  await finaliseTreatmentCheckout(admin, payments, screening, accountId, corePatientId);
  // Bloods in.
  const ref = await getLatestScreeningRef(admin, accountId);
  await receiveScreeningSample(admin, accountId, ref!.kit_ref);
  await attachScreeningResults(admin, accountId, ref!.kit_ref);
  return { accountId, corePatientId };
}

// ---------------------------------------------------------------------------
// The routing switch is pure and toggles cleanly.
// ---------------------------------------------------------------------------
describe('C3 GLP routing switch (pure)', () => {
  it('defaults to async, flips to consult on the flag', () => {
    expect(glpInitiationRoute({ consultRequired: false })).toBe('async');
    expect(glpInitiationRoute({ consultRequired: true })).toBe('consult');
    expect(glpInitiationRoute(glpRoutingFromEnv({ GLP_CONSULT_REQUIRED: false }))).toBe('async');
    expect(glpInitiationRoute(glpRoutingFromEnv({ GLP_CONSULT_REQUIRED: true }))).toBe('consult');
  });
});

// ---------------------------------------------------------------------------
// The consult descriptor + paying it gates the full-lane booking (consult_booked).
// ---------------------------------------------------------------------------
describe('C3 consult checkout: pay -> consult_booked reachable', () => {
  it('the consult descriptor resolves regardless of the rx flag (no medicine copy)', () => {
    expect(getProduct('consult', { weightLossRx: false })?.kind).toBe('consult');
    expect(getProduct('consult', { weightLossRx: true })?.kind).toBe('consult');
    const blob = JSON.stringify(PRODUCTS.consult).toLowerCase();
    expect(blob).not.toMatch(/mounjaro|wegovy|ozempic|semaglutide|tirzepatide|glp-?1|injection|\bjab\b|\bpen\b/);
  });

  it('a full-lane patient pays the consult via the shared surface, then books -> consult_booked', { timeout: 60_000 }, async () => {
    const { accountId } = await verifiedPatient('C3 Full-lane Patient');
    // Park them in the full lane at intake_submitted (as submitIntake(full) would).
    await setJourney(admin, accountId, 'intake_submitted', 'full');
    expect(await hasPaidConsult(admin, accountId)).toBe(false);

    await payConsultViaCheckout(accountId);
    // The consult gate flips + consent is captured against the checkout.
    expect(await hasPaidConsult(admin, accountId)).toBe(true);
    const consent = await getLatestCheckoutConsent(admin, accountId);
    expect(consent?.product).toBe('consult');

    await bookConsult(accountId);
    expect((await getJourney(admin, accountId))?.state).toBe('consult_booked');
  });
});

// ---------------------------------------------------------------------------
// The async base path is unaffected: default flag -> a screened weight patient
// routes to the async review queue exactly as before.
// ---------------------------------------------------------------------------
describe('C3 async base path (default): screened GLP -> review queue, unaffected', () => {
  it('routeScreenedWeightPatient(async) lands in_review_queue with a queue item', { timeout: 60_000 }, async () => {
    const { accountId } = await screenedWeightPatient();
    const route = glpInitiationRoute({ consultRequired: false });
    expect(route).toBe('async');

    const { data: intake } = await admin
      .from('intake_ref')
      .select('intake_id')
      .eq('account_id', accountId)
      .single();

    const res = await routeScreenedWeightPatient(admin, accountId, intake!.intake_id, route);
    expect(res.route).toBe('async');
    expect(res.queueItemId).toBeTruthy();
    expect((await getJourney(admin, accountId))?.state).toBe('in_review_queue');
    const queue = await listPendingFastQueue(admin);
    expect(queue.some((q) => q.id === res.queueItemId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The consult-mandatory path: switch on -> the SAME screened patient routes to the
// assessed lane, pays the consult, books (results_ready -> consult_booked), and a
// clinician issues. rx_issued via the clinician action only.
// ---------------------------------------------------------------------------
describe('C3 consult-mandatory path (switch on): screened GLP -> consult -> clinician issue', () => {
  it('routes to the consult lane, books, and reaches rx_issued ONLY via the clinician', { timeout: 60_000 }, async () => {
    const clinicianId = await freshClinician();
    const { accountId } = await screenedWeightPatient();
    const route = glpInitiationRoute({ consultRequired: true });
    expect(route).toBe('consult');

    const { data: intake } = await admin
      .from('intake_ref')
      .select('intake_id')
      .eq('account_id', accountId)
      .single();

    const res = await routeScreenedWeightPatient(admin, accountId, intake!.intake_id, route);
    expect(res.route).toBe('consult');
    expect(res.queueItemId).toBeNull();
    // No async queue item was created for the consult route.
    const queue = await listPendingFastQueue(admin);
    expect(queue.some((q) => q.account_id === accountId)).toBe(false);
    // Still at results_ready, now assigned the full lane.
    const j = await getJourney(admin, accountId);
    expect(j?.state).toBe('results_ready');
    expect(j?.lane).toBe('full');

    // Pay the consult + book (bookable from results_ready in C3).
    await payConsultViaCheckout(accountId);
    await bookConsult(accountId);
    expect((await getJourney(admin, accountId))?.state).toBe('consult_booked');

    // The clinician issues at the consult -> rx_issued (the ONLY path).
    const bookingRef = await getLatestBookingRef(admin, accountId);
    const result = await decideConsultAction(
      admin,
      core,
      {
        clinicianAccountId: clinicianId,
        bookingRefId: bookingRef!.id,
        action: 'issue',
        reason: 'bloods in range; consult done; issue',
        rxItems: [{ name: 'Treatment', dose: 'as directed', quantity: 1 }],
      },
      payments,
    );
    expect(result.newState).toBe('rx_issued');
  });
});

// ---------------------------------------------------------------------------
// Hard line unchanged by C3.
// ---------------------------------------------------------------------------
describe('C3 hard line: rx_issued predecessors unchanged', () => {
  it('the only predecessors of rx_issued remain approved and consult_done', () => {
    const predecessors = Object.entries(ALLOWED_TRANSITIONS)
      .filter(([, targets]) => (targets as readonly string[]).includes('rx_issued'))
      .map(([from]) => from)
      .sort();
    expect(predecessors).toEqual(['approved', 'consult_done']);
    expect([...RX_ISSUED_PREDECESSORS].sort()).toEqual(['approved', 'consult_done']);
    // Paying the consult does not create a machine edge into rx_issued.
    expect(canTransition('consult_booked', 'rx_issued')).toBe(false);
  });
});
