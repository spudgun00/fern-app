import { afterAll, describe, expect, it } from 'vitest';
import { readEnv } from '../src/lib/env';
import { createAdminClient } from '../src/lib/supabase/admin';
import { MockCore } from '../src/lib/adapters/mock-core';
import { MockPayments } from '../src/lib/adapters/mock-payments';
import { getScreening } from '../src/lib/adapters/factory';
import { decideClinicianAction } from '../src/lib/clinician/decide';
import { submitWeightIntake } from '../src/lib/weight/submit';
import type { WeightIntakeAnswers } from '../src/lib/intake/weight-routing';
import {
  advanceOnTreatmentPaid,
  finaliseTreatmentCheckout,
  startTreatmentCheckout,
} from '../src/lib/checkout/checkout';
import { getProduct, PRODUCTS } from '../src/lib/checkout/products';
import {
  attachScreeningResults,
  receiveScreeningSample,
  routeScreenedToReview,
} from '../src/lib/screening/order';
import { canTransition, RX_ISSUED_PREDECESSORS } from '../src/lib/journey/machine';
import {
  advanceJourney,
  ensureAccount,
  getJourney,
  getLatestCheckoutConsent,
  getLatestIntakeRef,
  getLatestPaymentRef,
  getLatestScreeningRef,
  hasPaidTreatment,
  recordIntakeRef,
  setCorePatientId,
  setJourney,
} from '../src/lib/accounts';

// ===========================================================================
// Checkout C2 — the shared one-off checkout (journeys A + B). One /checkout
// surface, driven by a product descriptor, over the pay-first 'treatment' kind.
//
// THE GATE proven here: a completed test-mode payment advances the journey to the
// SCREENING branch (screening_kit_sent) and NOTHING more. rx_issued stays
// unreachable without the clinician predecessors. The built refund-on-refusal (P4)
// still fires on refuse; approve keeps the charge and reaches rx_issued ONLY via
// the clinician action.
// ===========================================================================

const env = { ...readEnv(), CORE_IMPL: 'mock', SCREENING_IMPL: 'mock', PAYMENTS_IMPL: 'mock' };
const admin = createAdminClient(env);
const core = new MockCore(admin);
const payments = new MockPayments(admin);
const screening = getScreening(env, admin);
const createdAccounts: string[] = [];

afterAll(async () => {
  if (createdAccounts.length === 0) return;
  await admin.from('mock_payment_session').delete().in('account_id', createdAccounts);
  await admin.from('checkout_consent').delete().in('account_id', createdAccounts);
  // Account delete cascades journey / queue_item / payment_ref / screening_ref / intake_ref.
  await admin.from('account').delete().in('id', createdAccounts);
});

function sessionIdFromClientUrl(clientUrl: string): string {
  return new URL(clientUrl, 'https://x').searchParams.get('session')!;
}

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

// A weight patient who has completed the GLP intake with the kit DEFERRED to the
// checkout (the C2 flow): sits at intake_submitted, no screening kit yet.
async function weightPatientAtIntakeSubmitted() {
  const { accountId, corePatientId } = await verifiedPatient('C2 Weight Patient');
  await submitWeightIntake(admin, core, screening, accountId, corePatientId, cleanWeightAnswers(), {
    orderKit: false,
  });
  return { accountId, corePatientId };
}

// A menopause patient at intake_submitted (screen-first, journey A): an intake is
// recorded and the journey parked at intake_submitted, awaiting the paid screen.
async function menopausePatientAtIntakeSubmitted() {
  const { accountId, corePatientId } = await verifiedPatient('C2 Menopause Patient');
  const intakeId = await core.saveIntake(corePatientId, {
    condition: 'menopause',
    lane: 'fast',
    answers: { treatmentHistory: 'continuing' },
    routing: { outcome: 'fast', lane: 'fast', reasons: [] },
  });
  await advanceJourney(admin, accountId, 'intake_started');
  await advanceJourney(admin, accountId, 'intake_submitted');
  await recordIntakeRef(admin, accountId, intakeId, 'fast', 'submitted');
  return { accountId, corePatientId };
}

// Pay a treatment checkout through the mock the way the routes do, then finalise
// (which runs the gate). Returns the session id.
async function payTreatment(
  product: (typeof PRODUCTS)[keyof typeof PRODUCTS],
  accountId: string,
  corePatientId: string,
): Promise<string> {
  const clientUrl = await startTreatmentCheckout(
    admin,
    payments,
    product,
    accountId,
    '/checkout/complete',
  );
  const sessionId = sessionIdFromClientUrl(clientUrl);
  await payments.markPaid(sessionId);
  await finaliseTreatmentCheckout(admin, payments, screening, accountId, corePatientId);
  return sessionId;
}

// Drive the screening branch to results_ready and route into the review queue.
async function toReviewQueue(accountId: string): Promise<string> {
  const ref = await getLatestScreeningRef(admin, accountId);
  await receiveScreeningSample(admin, accountId, ref!.kit_ref);
  await attachScreeningResults(admin, accountId, ref!.kit_ref);
  const intakeRef = await getLatestIntakeRef(admin, accountId);
  return routeScreenedToReview(admin, accountId, intakeRef!.intake_id);
}

// ---------------------------------------------------------------------------
// The required per-paying-journey test: a successful test-mode payment advances
// ONLY to the correct non-clinical state (screening), and rx_issued stays
// unreachable without the clinician predecessors.
// ---------------------------------------------------------------------------
describe('C2 gate: a paid treatment checkout advances to SCREENING only', () => {
  it('journey B (weight): pay -> screening_kit_sent, no decision state, rx_issued unreachable', { timeout: 60_000 }, async () => {
    const { accountId, corePatientId } = await weightPatientAtIntakeSubmitted();
    expect((await getJourney(admin, accountId))?.state).toBe('intake_submitted');
    expect(await hasPaidTreatment(admin, accountId)).toBe(false);

    await payTreatment(PRODUCTS.weight_treatment, accountId, corePatientId);

    // Advanced to the non-clinical screening state ONLY.
    expect(await hasPaidTreatment(admin, accountId)).toBe(true);
    expect((await getJourney(admin, accountId))?.state).toBe('screening_kit_sent');
    expect((await getLatestScreeningRef(admin, accountId))?.status).toBe('kit_sent');

    // rx_issued is not reachable from the screening branch, and the predecessors
    // are unchanged: money advanced the screening step, never a prescription.
    expect(canTransition('screening_kit_sent', 'rx_issued')).toBe(false);
    expect([...RX_ISSUED_PREDECESSORS].sort()).toEqual(['approved', 'consult_done']);
  });

  it('journey A (menopause screen): pay -> screening_kit_sent, no decision state', { timeout: 60_000 }, async () => {
    const { accountId, corePatientId } = await menopausePatientAtIntakeSubmitted();
    expect((await getJourney(admin, accountId))?.state).toBe('intake_submitted');

    await payTreatment(PRODUCTS.menopause_screen, accountId, corePatientId);

    expect((await getJourney(admin, accountId))?.state).toBe('screening_kit_sent');
    expect((await getLatestScreeningRef(admin, accountId))?.status).toBe('kit_sent');
  });

  it('the gate is a no-op when treatment is NOT paid (pending only)', { timeout: 60_000 }, async () => {
    const { accountId, corePatientId } = await weightPatientAtIntakeSubmitted();
    // Start the checkout but do NOT pay: only a pending pointer exists.
    await startTreatmentCheckout(admin, payments, PRODUCTS.weight_treatment, accountId, '/r');

    const gate = await advanceOnTreatmentPaid(admin, screening, accountId, corePatientId);
    expect(gate.advancedToScreening).toBe(false);
    expect(gate.paymentStatus).toBe('pending');
    expect((await getJourney(admin, accountId))?.state).toBe('intake_submitted');
    expect(await getLatestScreeningRef(admin, accountId)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Consent capture (waitlist discipline): every checkout logs explicit consent.
// ---------------------------------------------------------------------------
describe('C2 consent: the checkout records explicit, timestamped consent', () => {
  it('startTreatmentCheckout writes a checkout_consent row tied to the session + product', { timeout: 60_000 }, async () => {
    const { accountId } = await weightPatientAtIntakeSubmitted();
    const clientUrl = await startTreatmentCheckout(
      admin,
      payments,
      PRODUCTS.weight_treatment,
      accountId,
      '/r',
    );
    const sessionId = sessionIdFromClientUrl(clientUrl);

    const consent = await getLatestCheckoutConsent(admin, accountId);
    expect(consent).not.toBeNull();
    expect(consent!.product).toBe('weight_treatment');
    expect(consent!.provider_ref).toBe(sessionId);
    expect(consent!.created_at).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Refund-on-refusal (P4, upstream-composed): pay -> screening -> refuse -> the
// pay-first charge is returned automatically. NOT re-implemented here — asserted.
// ---------------------------------------------------------------------------
describe('C2 pay -> refuse: the pay-first charge is auto-refunded', () => {
  it('REFUSE after a paid screening refunds the treatment charge', { timeout: 60_000 }, async () => {
    const clinicianId = await freshClinician();
    const { accountId, corePatientId } = await weightPatientAtIntakeSubmitted();
    await payTreatment(PRODUCTS.weight_treatment, accountId, corePatientId);
    const queueItemId = await toReviewQueue(accountId);

    const result = await decideClinicianAction(
      admin,
      core,
      { clinicianAccountId: clinicianId, queueItemId, action: 'refuse', reason: 'not suitable now' },
      payments,
    );

    expect(result.newState).toBe('refused');
    expect(result.refunded).toBe(true);
    expect((await getLatestPaymentRef(admin, accountId, 'treatment'))?.status).toBe('refunded');
    const ref = await getLatestPaymentRef(admin, accountId, 'treatment');
    const { data } = await admin
      .from('mock_payment_session')
      .select('status')
      .eq('id', ref!.provider_ref!)
      .single();
    expect(data!.status).toBe('refunded');
  });
});

// ---------------------------------------------------------------------------
// pay -> approve: rx_issued reached ONLY via the clinician action; charge kept.
// ---------------------------------------------------------------------------
describe('C2 pay -> approve: rx_issued via the clinician action only', () => {
  it('APPROVE after a paid screening reaches rx_issued and keeps the charge', { timeout: 60_000 }, async () => {
    const clinicianId = await freshClinician();
    const { accountId, corePatientId } = await weightPatientAtIntakeSubmitted();
    await payTreatment(PRODUCTS.weight_treatment, accountId, corePatientId);
    const queueItemId = await toReviewQueue(accountId);

    // Before the clinician decides, the patient is NOT at rx_issued: paying did not
    // create a prescription path.
    expect((await getJourney(admin, accountId))?.state).toBe('in_review_queue');

    const result = await decideClinicianAction(
      admin,
      core,
      {
        clinicianAccountId: clinicianId,
        queueItemId,
        action: 'approve',
        reason: 'bloods in range; approve',
        rxItems: [{ name: 'Treatment', dose: 'as directed', quantity: 1 }],
      },
      payments,
    );

    expect(result.newState).toBe('rx_issued');
    expect(result.refunded).toBe(false);
    expect((await getLatestPaymentRef(admin, accountId, 'treatment'))?.status).toBe('paid');
  });
});

// ---------------------------------------------------------------------------
// Descriptor copy is clean (render-data proof, no dist grep): with the flag off
// the weight product does not resolve; no descriptor names a medicine or says
// "free"; the menopause screen resolves regardless of the rx flag.
// ---------------------------------------------------------------------------
describe('C2 copy discipline (product descriptors)', () => {
  const DRUG_TERMS =
    /mounjaro|wegovy|ozempic|semaglutide|tirzepatide|glp-?1|injection|inject|\bjab\b|\bpen\b/i;

  it('weight_treatment does NOT resolve when weightLossRx is off', () => {
    expect(getProduct('weight_treatment', { weightLossRx: false })).toBeNull();
    expect(getProduct('weight_treatment', { weightLossRx: true })?.id).toBe('weight_treatment');
  });

  it('menopause_screen resolves regardless of the rx flag', () => {
    expect(getProduct('menopause_screen', { weightLossRx: false })?.id).toBe('menopause_screen');
    expect(getProduct('menopause_screen', { weightLossRx: true })?.id).toBe('menopause_screen');
  });

  it('no descriptor names a medicine or says "free"; each frames the screen by its worth', () => {
    for (const product of Object.values(PRODUCTS)) {
      const blob = JSON.stringify(product).toLowerCase();
      expect(blob, `${product.id} contains a drug-adjacent term`).not.toMatch(DRUG_TERMS);
      expect(blob, `${product.id} says "free"`).not.toContain('free');
      // The screen is framed by its worth (credited to / included, worth £X),
      // never "free".
      expect(blob, `${product.id} does not state a worth`).toContain('worth');
    }
    // Journey A specifically credits the screen to treatment.
    expect(JSON.stringify(PRODUCTS.menopause_screen).toLowerCase()).toContain('credited');
  });

  it('journey A carries a labelled placeholder for the pending treatment step, not a drug name', () => {
    const a = PRODUCTS.menopause_screen;
    expect(a.pendingTreatmentNote).toMatch(/pending menopause catalogue/i);
    expect(a.pendingTreatmentNote?.toLowerCase()).not.toMatch(DRUG_TERMS);
  });
});
