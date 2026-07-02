import { afterAll, describe, expect, it } from 'vitest';
import { readEnv } from '../src/lib/env';
import { createAdminClient } from '../src/lib/supabase/admin';
import { MockCore } from '../src/lib/adapters/mock-core';
import { MockDispensing } from '../src/lib/adapters/mock-dispensing';
import { MockPayments } from '../src/lib/adapters/mock-payments';
import { submitIntake } from '../src/lib/intake/submit';
import { decideClinicianAction } from '../src/lib/clinician/decide';
import { advanceDispensing, dispenseIssuedScript, lodgeRepeatRequest } from '../src/lib/dispensing/dispense';
import {
  finaliseLatestPending,
  finaliseMembershipCancel,
  getOrCreateCustomer,
  startCheckout,
  startSubscription,
} from '../src/lib/payments/billing';
import { RX_ISSUED_PREDECESSORS } from '../src/lib/journey/machine';
import type { IntakeAnswers } from '../src/lib/intake/routing';
import {
  ensureAccount,
  getJourney,
  getMembership,
  getPaymentsCustomerRef,
  hasPaidConsult,
  isActiveMember,
  listPendingFastQueue,
  setCorePatientId,
  setJourney,
} from '../src/lib/accounts';

// ===========================================================================
// Checkout C4 — membership (Journey D) via Stripe Billing (mocked) + the customer
// portal + member repeats (Journey E). Builds on P5's proven money loop and adds
// the ONE-CUSTOMER-PER-PATIENT invariant (spec s4): the one-offs, the
// subscription, and the portal all attach to the same provider customer.
// ===========================================================================

function fastLaneAnswers(): IntakeAnswers {
  return {
    treatmentHistory: 'continuing',
    symptoms: ['hot_flushes', 'night_sweats'],
    monthsSinceLastPeriod: 18,
    bpSystolic: 124,
    bpDiastolic: 78,
    clotHistory: false,
    breastCancerHistory: false,
    liverDisease: false,
    unexplainedBleeding: false,
    currentPregnancy: false,
    suspectedClotSymptoms: false,
    undiagnosedBreastLump: false,
  };
}

const env = {
  ...readEnv(),
  CORE_IMPL: 'mock',
  DISPENSING_IMPL: 'mock',
  PAYMENTS_IMPL: 'mock',
};
const admin = createAdminClient(env);
const core = new MockCore(admin);
const dispensing = new MockDispensing(admin);
const payments = new MockPayments(admin);
const createdAccounts: string[] = [];

afterAll(async () => {
  if (createdAccounts.length === 0) return;
  await admin.from('mock_payment_session').delete().in('account_id', createdAccounts);
  await admin.from('payments_customer').delete().in('account_id', createdAccounts);
  await admin.from('account').delete().in('id', createdAccounts);
});

async function freshClinician(): Promise<string> {
  const account = await ensureAccount(admin, crypto.randomUUID());
  createdAccounts.push(account.id);
  await admin.from('account').update({ role: 'clinician' }).eq('id', account.id);
  return account.id;
}

async function patientAtDelivered(): Promise<{ accountId: string; corePatientId: string }> {
  const clinicianId = await freshClinician();
  const account = await ensureAccount(admin, crypto.randomUUID());
  createdAccounts.push(account.id);
  const corePatientId = await core.createPatient({ fullName: 'C4 Test Patient' });
  await setCorePatientId(admin, account.id, corePatientId);
  await setJourney(admin, account.id, 'id_verified', null);
  await submitIntake(admin, core, account.id, corePatientId, 'menopause', fastLaneAnswers());
  const { data } = await admin.from('queue_item').select('*').eq('account_id', account.id).single();
  const decision = await decideClinicianAction(admin, core, {
    clinicianAccountId: clinicianId,
    queueItemId: data.id,
    action: 'approve',
    reason: 'Clear continuing picture.',
    rxItems: [{ name: 'Transdermal HRT', dose: 'as directed', quantity: 1 }],
  });
  await dispenseIssuedScript(admin, core, dispensing, {
    accountId: account.id,
    corePatientId,
    rxId: decision.rxId!,
  });
  await advanceDispensing(admin, dispensing, account.id, new Date().toISOString());
  await advanceDispensing(admin, dispensing, account.id, new Date().toISOString());
  return { accountId: account.id, corePatientId };
}

function sessionIdFromClientUrl(clientUrl: string): string {
  return new URL(clientUrl, 'https://x').searchParams.get('session')!;
}

async function paySubscription(accountId: string): Promise<void> {
  const clientUrl = await startSubscription(admin, payments, accountId, '/account/billing/complete');
  await payments.markPaid(sessionIdFromClientUrl(clientUrl));
  await finaliseLatestPending(admin, payments, accountId);
}

async function payConsult(accountId: string): Promise<string> {
  const clientUrl = await startCheckout(admin, payments, 'consult', accountId, '/r');
  const sessionId = sessionIdFromClientUrl(clientUrl);
  await payments.markPaid(sessionId);
  await finaliseLatestPending(admin, payments, accountId);
  return sessionId;
}

// ---------------------------------------------------------------------------
// Journey D: subscribing activates membership and advances to active_member.
// ---------------------------------------------------------------------------
describe('C4 membership: startSubscription -> active_member', () => {
  it('a delivered patient who subscribes advances delivered -> active_member', { timeout: 60_000 }, async () => {
    const { accountId } = await patientAtDelivered();
    expect((await getJourney(admin, accountId))?.state).toBe('delivered');

    await paySubscription(accountId);

    expect(await isActiveMember(admin, accountId)).toBe(true);
    const membership = await getMembership(admin, accountId);
    expect(membership?.status).toBe('active');
    expect(membership?.provider_customer_ref).toBeTruthy();
    expect(membership?.provider_subscription_ref).toBeTruthy();
    expect((await getJourney(admin, accountId))?.state).toBe('active_member');
  });
});

// ---------------------------------------------------------------------------
// ONE customer per patient across one-offs + subscription (the C4 invariant).
// ---------------------------------------------------------------------------
describe('C4 one customer per patient across one-offs + subscription', () => {
  it('a one-off consult and a later subscription share the SAME provider customer', { timeout: 60_000 }, async () => {
    const { accountId } = await patientAtDelivered();

    // First a one-off consult: creates + stores the single customer.
    const consultSession = await payConsult(accountId);
    expect(await hasPaidConsult(admin, accountId)).toBe(true);
    const custAfterConsult = await getPaymentsCustomerRef(admin, accountId);
    expect(custAfterConsult).toBeTruthy();

    // The one-off session is attached to that customer.
    const { data: consultRow } = await admin
      .from('mock_payment_session')
      .select('customer_ref')
      .eq('id', consultSession)
      .single();
    expect(consultRow!.customer_ref).toBe(custAfterConsult);

    // Then subscribe: the subscription rides the SAME customer, and the stored
    // pointer does not change (one customer per patient).
    await paySubscription(accountId);
    const membership = await getMembership(admin, accountId);
    expect(membership?.provider_customer_ref).toBe(custAfterConsult);
    expect(await getPaymentsCustomerRef(admin, accountId)).toBe(custAfterConsult);
  });

  it('getOrCreateCustomer is idempotent: a second call returns the same customer', { timeout: 60_000 }, async () => {
    const account = await ensureAccount(admin, crypto.randomUUID());
    createdAccounts.push(account.id);
    const first = await getOrCreateCustomer(admin, payments, account.id);
    const second = await getOrCreateCustomer(admin, payments, account.id);
    expect(first).toBe(second);
  });
});

// ---------------------------------------------------------------------------
// Cancel in the portal -> membership state updates (loses member access).
// ---------------------------------------------------------------------------
describe('C4 portal cancel: membership flips to canceled', () => {
  it('cancelling deactivates membership and revokes the no-charge repeat', { timeout: 60_000 }, async () => {
    const { accountId, corePatientId } = await patientAtDelivered();
    await paySubscription(accountId);
    const membership = await getMembership(admin, accountId);

    // The portal cancel maps the customer back to the membership (mock stands in
    // for the customer.subscription.deleted webhook).
    await payments.cancelByCustomer(membership!.provider_customer_ref!);
    await finaliseMembershipCancel(admin, membership!.provider_customer_ref!);

    expect(await isActiveMember(admin, accountId)).toBe(false);
    expect((await getMembership(admin, accountId))?.status).toBe('canceled');

    await expect(
      lodgeRepeatRequest(admin, core, accountId, corePatientId),
    ).rejects.toThrow(/active membership/i);
  });
});

// ---------------------------------------------------------------------------
// Journey E: a member's repeat enters the review queue, NO new charge, and is
// NEVER auto-issued (a clinician still decides — the hard line).
// ---------------------------------------------------------------------------
describe('C4 member repeat (Journey E): queue, no charge, not auto-issued', () => {
  it('an active member lodges a repeat that enters the queue with no consult charge and no script', { timeout: 60_000 }, async () => {
    const { accountId, corePatientId } = await patientAtDelivered();
    await paySubscription(accountId);
    expect(await isActiveMember(admin, accountId)).toBe(true);

    // One script exists so far (the initial approval).
    expect(await core.getPrescriptions(corePatientId)).toHaveLength(1);

    const { queueItemId } = await lodgeRepeatRequest(admin, core, accountId, corePatientId);

    // The repeat entered the review queue.
    const queue = await listPendingFastQueue(admin);
    expect(queue.some((q) => q.id === queueItemId)).toBe(true);

    // NO new consult charge was raised for the repeat (members ride free).
    const { data: consultPayments } = await admin
      .from('payment_ref')
      .select('*')
      .eq('account_id', accountId)
      .eq('kind', 'consult');
    expect(consultPayments?.length ?? 0).toBe(0);

    // Hard line: lodging a repeat issues NO script — still exactly one, a clinician
    // decides the repeat.
    expect(await core.getPrescriptions(corePatientId)).toHaveLength(1);
  });

  it('a NON-member cannot lodge a no-charge repeat', { timeout: 60_000 }, async () => {
    const { accountId, corePatientId } = await patientAtDelivered();
    await expect(
      lodgeRepeatRequest(admin, core, accountId, corePatientId),
    ).rejects.toThrow(/active membership/i);
  });

  it('the hard line is intact: rx_issued predecessors unchanged', () => {
    expect([...RX_ISSUED_PREDECESSORS].sort()).toEqual(['approved', 'consult_done']);
  });
});
