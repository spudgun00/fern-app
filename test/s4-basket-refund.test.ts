import { afterAll, describe, expect, it } from 'vitest';
import { readEnv } from '../src/lib/env';
import { createAdminClient } from '../src/lib/supabase/admin';
import { MockCore } from '../src/lib/adapters/mock-core';
import { MockPayments } from '../src/lib/adapters/mock-payments';
import { getScreening } from '../src/lib/adapters/factory';
import { addCartItem, type CartFlags } from '../src/lib/cart/cart';
import { finaliseBasketCheckout, startBasketCheckout } from '../src/lib/checkout/basket';
import { decideClinicianAction } from '../src/lib/clinician/decide';
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
  getLatestIntakeRef,
  getLatestPaymentRef,
  getLatestScreeningRef,
  listOtcFulfilment,
  recordIntakeRef,
  setCorePatientId,
  setJourney,
} from '../src/lib/accounts';

// ===========================================================================
// Shop S4 — per-line refund on refusal for a mixed basket. Refuse the prescription
// line -> ONLY that line is refunded (a partial refund of its amount); the OTC
// lines stay shipped and the basket-level payment stays paid. Reuses the P4
// refund-on-refusal, composed into the clinician refuse branch.
//
// THE HARD LINE holds: no path issues a script; RX_ISSUED_PREDECESSORS stays
// {approved, consult_done}. (The 3 machine hard-line tests live in journey.test.ts,
// unchanged.)
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

async function freshClinician(): Promise<string> {
  const account = await ensureAccount(admin, crypto.randomUUID());
  createdAccounts.push(account.id);
  await admin.from('account').update({ role: 'clinician' }).eq('id', account.id);
  return account.id;
}

async function patientAtIntakeSubmitted(name: string) {
  const account = await ensureAccount(admin, crypto.randomUUID());
  createdAccounts.push(account.id);
  const corePatientId = await core.createPatient({ fullName: name });
  await setCorePatientId(admin, account.id, corePatientId);
  await setJourney(admin, account.id, 'id_verified', null);
  const intakeId = await core.saveIntake(corePatientId, {
    condition: 'menopause',
    lane: 'fast',
    answers: { treatmentHistory: 'continuing' },
    routing: { outcome: 'fast', lane: 'fast', reasons: [] },
  });
  await advanceJourney(admin, account.id, 'intake_started');
  await advanceJourney(admin, account.id, 'intake_submitted');
  await recordIntakeRef(admin, account.id, intakeId, 'fast', 'submitted');
  return { accountId: account.id, corePatientId };
}

async function payBasket(accountId: string, corePatientId: string): Promise<string> {
  const clientUrl = await startBasketCheckout(admin, payments, accountId, flags, '/checkout/complete?basket=1');
  const sessionId = sessionIdFromClientUrl(clientUrl);
  await payments.markPaid(sessionId);
  await finaliseBasketCheckout(admin, payments, screening, accountId, corePatientId, flags);
  return sessionId;
}

async function toReviewQueue(accountId: string): Promise<string> {
  const ref = await getLatestScreeningRef(admin, accountId);
  await receiveScreeningSample(admin, accountId, ref!.kit_ref);
  await attachScreeningResults(admin, accountId, ref!.kit_ref);
  const intakeRef = await getLatestIntakeRef(admin, accountId);
  return routeScreenedToReview(admin, accountId, intakeRef!.intake_id);
}

async function sessionStatus(sessionId: string): Promise<string> {
  const { data } = await admin.from('mock_payment_session').select('status').eq('id', sessionId).single();
  return data!.status as string;
}

describe('S4 mixed basket: refuse the prescription line -> only that line refunded', () => {
  it('refuse -> prescription line refunded (partial), OTC still shipped, no script', { timeout: 60_000 }, async () => {
    const clinicianId = await freshClinician();
    const { accountId, corePatientId } = await patientAtIntakeSubmitted('S4 Mixed');
    await addCartItem(admin, accountId, 'otc', 'vitamin-d3');
    await addCartItem(admin, accountId, 'otc', 'calcium');
    await addCartItem(admin, accountId, 'prescription', 'menopause_screen');

    const session = await payBasket(accountId, corePatientId);
    const queueItemId = await toReviewQueue(accountId);

    // The clinician REFUSES the prescription line.
    const result = await decideClinicianAction(
      admin,
      core,
      { clinicianAccountId: clinicianId, queueItemId, action: 'refuse', reason: 'not suitable now' },
      payments,
    );

    expect(result.newState).toBe('refused');
    expect(result.refunded).toBe(true);

    // ONLY the prescription (treatment) pointer is refunded ...
    expect((await getLatestPaymentRef(admin, accountId, 'treatment'))?.status).toBe('refunded');
    // ... the basket-level payment (the OTC portion) is UNCHANGED (still paid) ...
    expect((await getLatestPaymentRef(admin, accountId, 'basket'))?.status).toBe('paid');
    // ... the provider did a PARTIAL refund (not a full session refund) ...
    expect(await sessionStatus(session)).toBe('partially_refunded');

    // ... and the OTC lines are still shipped (untouched by the refusal).
    const otc = await listOtcFulfilment(admin, accountId);
    expect(otc.map((f) => f.ref_id).sort()).toEqual(['calcium', 'vitamin-d3']);
    expect(otc.every((f) => f.status === 'dispatched')).toBe(true);

    // No script was ever issued; the hard line is intact.
    expect((await core.getPrescriptions(corePatientId)).length).toBe(0);
    expect([...RX_ISSUED_PREDECESSORS].sort()).toEqual(['approved', 'consult_done']);
    expect(canTransition('refused', 'rx_issued')).toBe(false);
  });

  it('an APPROVED basket keeps the charge (no refund) and reaches rx_issued only via the clinician', { timeout: 60_000 }, async () => {
    const clinicianId = await freshClinician();
    const { accountId, corePatientId } = await patientAtIntakeSubmitted('S4 Approve');
    await addCartItem(admin, accountId, 'otc', 'vitamin-d3');
    await addCartItem(admin, accountId, 'prescription', 'menopause_screen');

    const session = await payBasket(accountId, corePatientId);
    const queueItemId = await toReviewQueue(accountId);

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

    // rx_issued reached ONLY via the clinician approve; the basket charge is kept.
    expect(result.newState).toBe('rx_issued');
    expect(result.refunded).toBe(false);
    expect((await getLatestPaymentRef(admin, accountId, 'treatment'))?.status).toBe('paid');
    expect((await getLatestPaymentRef(admin, accountId, 'basket'))?.status).toBe('paid');
    expect(await sessionStatus(session)).toBe('complete');
    // The OTC line is still shipped either way.
    expect((await listOtcFulfilment(admin, accountId)).length).toBe(1);
  });
});

// The non-basket (standalone weight P4) full-refund path is unchanged by S4 and is
// proven by test/c2-checkout.test.ts ("REFUSE after a paid screening refunds the
// treatment charge") — refundOnRefusal takes the full-refund branch when no basket
// payment_ref shares the session.
