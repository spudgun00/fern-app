import { afterAll, describe, expect, it } from 'vitest';
import { readEnv } from '../src/lib/env';
import { createAdminClient } from '../src/lib/supabase/admin';
import { MockCore } from '../src/lib/adapters/mock-core';
import { MockPayments } from '../src/lib/adapters/mock-payments';
import { getScreening } from '../src/lib/adapters/factory';
import { addCartItem } from '../src/lib/cart/cart';
import type { CartFlags } from '../src/lib/cart/cart';
import {
  finaliseBasketCheckout,
  startBasketCheckout,
} from '../src/lib/checkout/basket';
import { canTransition, RX_ISSUED_PREDECESSORS } from '../src/lib/journey/machine';
import {
  advanceJourney,
  ensureAccount,
  getJourney,
  getLatestPaymentRef,
  listOtcFulfilment,
  recordIntakeRef,
  setCorePatientId,
  setJourney,
} from '../src/lib/accounts';

// ===========================================================================
// Shop S3 — the unified checkout + fulfilment router. THE mixed-basket test:
// ONE payment for the whole basket, then OTC lines fulfil ("dispatched") while a
// prescription line reaches SCREENING ONLY — no script issued. The hard line holds:
// the basket payment gates OTC fulfilment + entry to the journey, NEVER rx_issued;
// RX_ISSUED_PREDECESSORS stays {approved, consult_done}.
// ===========================================================================

const env = { ...readEnv(), CORE_IMPL: 'mock', SCREENING_IMPL: 'mock', PAYMENTS_IMPL: 'mock' };
const admin = createAdminClient(env);
const core = new MockCore(admin);
const payments = new MockPayments(admin);
const screening = getScreening(env, admin);
const createdAccounts: string[] = [];

const flags: CartFlags = {
  otcShop: true,
  otcCategories: ['bone-muscle', 'sleep-calm'],
  weightLossRx: true,
  menopauseRx: true,
};

afterAll(async () => {
  if (createdAccounts.length === 0) return;
  await admin.from('mock_payment_session').delete().in('account_id', createdAccounts);
  await admin.from('checkout_consent').delete().in('account_id', createdAccounts);
  await admin.from('otc_fulfilment').delete().in('account_id', createdAccounts);
  await admin.from('cart_item').delete().in('account_id', createdAccounts);
  await admin.from('account').delete().in('id', createdAccounts);
});

function sessionIdFromClientUrl(clientUrl: string): string {
  return new URL(clientUrl, 'https://x').searchParams.get('session')!;
}

async function verifiedPatient(name: string): Promise<{ accountId: string; corePatientId: string }> {
  const account = await ensureAccount(admin, crypto.randomUUID());
  createdAccounts.push(account.id);
  const corePatientId = await core.createPatient({ fullName: name });
  await setCorePatientId(admin, account.id, corePatientId);
  await setJourney(admin, account.id, 'id_verified', null);
  return { accountId: account.id, corePatientId };
}

// A menopause patient parked at intake_submitted (screen-first), ready for the paid
// screen — the precondition the prescription (treatment) line needs to enter screening.
async function patientAtIntakeSubmitted(name: string) {
  const { accountId, corePatientId } = await verifiedPatient(name);
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

// Pay a basket the way the routes do: start -> mark the mock session paid -> finalise
// (which runs the fulfilment router). Returns the basket session id.
async function payBasket(accountId: string, corePatientId: string): Promise<string> {
  const clientUrl = await startBasketCheckout(admin, payments, accountId, flags, '/checkout/complete?basket=1');
  const sessionId = sessionIdFromClientUrl(clientUrl);
  await payments.markPaid(sessionId);
  await finaliseBasketCheckout(admin, payments, screening, accountId, corePatientId, flags);
  return sessionId;
}

describe('S3 mixed basket: pay once -> OTC fulfils, POM reaches screening, no script', () => {
  it('OTC dispatched now; prescription line -> screening_kit_sent; rx_issued unreachable', { timeout: 60_000 }, async () => {
    const { accountId, corePatientId } = await patientAtIntakeSubmitted('S3 Mixed');
    // A mixed basket: two OTC lines + one prescription (treatment) line.
    await addCartItem(admin, accountId, 'otc', 'vitamin-d3');
    await addCartItem(admin, accountId, 'otc', 'magnesium-glycinate');
    await addCartItem(admin, accountId, 'prescription', 'menopause_screen');

    const session = await payBasket(accountId, corePatientId);

    // OTC lines fulfilled ("ships now"), independent of any clinical state.
    const otc = await listOtcFulfilment(admin, accountId);
    expect(otc.map((f) => f.ref_id).sort()).toEqual(['magnesium-glycinate', 'vitamin-d3']);
    expect(otc.every((f) => f.status === 'dispatched')).toBe(true);
    expect(otc.every((f) => f.provider_ref === session)).toBe(true);

    // The prescription line entered the journey at the SCREENING branch only.
    expect((await getJourney(admin, accountId))?.state).toBe('screening_kit_sent');
    // The one payment is recorded; the treatment handle points at the basket session.
    expect((await getLatestPaymentRef(admin, accountId, 'basket'))?.status).toBe('paid');
    expect((await getLatestPaymentRef(admin, accountId, 'treatment'))?.status).toBe('paid');

    // NO script was issued: no path reached a decision state or rx_issued.
    expect((await core.getPrescriptions(corePatientId)).length).toBe(0);
    expect(canTransition('screening_kit_sent', 'rx_issued')).toBe(false);
    expect([...RX_ISSUED_PREDECESSORS].sort()).toEqual(['approved', 'consult_done']);

    // The basket was cleared after fulfilment.
    const { data: cartRows } = await admin.from('cart_item').select('id').eq('account_id', accountId);
    expect(cartRows?.length ?? 0).toBe(0);
  });

  it('finalise is idempotent (a re-poll after the cart is cleared changes nothing)', { timeout: 60_000 }, async () => {
    const { accountId, corePatientId } = await patientAtIntakeSubmitted('S3 Idempotent');
    await addCartItem(admin, accountId, 'otc', 'vitamin-d3');
    await addCartItem(admin, accountId, 'prescription', 'menopause_screen');
    await payBasket(accountId, corePatientId);

    // Re-run finalise (webhook + return page both call it).
    await finaliseBasketCheckout(admin, payments, screening, accountId, corePatientId, flags);

    expect((await listOtcFulfilment(admin, accountId)).length).toBe(1);
    expect((await getJourney(admin, accountId))?.state).toBe('screening_kit_sent');
    expect((await core.getPrescriptions(corePatientId)).length).toBe(0);
  });
});

describe('S3 OTC-only basket: pure e-commerce, no clinical state touched', () => {
  it('pay -> OTC dispatched, journey unchanged, no treatment ref, no script', { timeout: 60_000 }, async () => {
    // A verified patient with NO intake: an OTC-only basket must never enter the journey.
    const { accountId, corePatientId } = await verifiedPatient('S3 OTC Only');
    await addCartItem(admin, accountId, 'otc', 'vitamin-d3');
    await addCartItem(admin, accountId, 'otc', 'calcium');

    await payBasket(accountId, corePatientId);

    const otc = await listOtcFulfilment(admin, accountId);
    expect(otc.map((f) => f.ref_id).sort()).toEqual(['calcium', 'vitamin-d3']);
    // No clinical state: the journey is untouched, no treatment payment, no script.
    expect((await getJourney(admin, accountId))?.state).toBe('id_verified');
    expect(await getLatestPaymentRef(admin, accountId, 'treatment')).toBeNull();
    expect((await core.getPrescriptions(corePatientId)).length).toBe(0);
  });
});
