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
  startCheckout,
} from '../src/lib/payments/billing';
import type { IntakeAnswers } from '../src/lib/intake/routing';
import {
  ensureAccount,
  getJourney,
  hasPaidConsult,
  isActiveMember,
  getMembership,
  listPendingFastQueue,
  setCorePatientId,
  setJourney,
} from '../src/lib/accounts';

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
  IDENTITY_IMPL: 'mock',
  PAYMENTS_IMPL: 'mock',
};
const admin = createAdminClient(env);
const core = new MockCore(admin);
const dispensing = new MockDispensing(admin);
const payments = new MockPayments(admin);
const createdAccounts: string[] = [];

async function freshClinician(): Promise<string> {
  const account = await ensureAccount(admin, crypto.randomUUID());
  createdAccounts.push(account.id);
  const { error } = await admin.from('account').update({ role: 'clinician' }).eq('id', account.id);
  if (error) throw new Error(error.message);
  return account.id;
}

async function freshPatient(): Promise<{ accountId: string; corePatientId: string }> {
  const account = await ensureAccount(admin, crypto.randomUUID());
  createdAccounts.push(account.id);
  const corePatientId = await core.createPatient({ fullName: 'P5 Test Patient' });
  await setCorePatientId(admin, account.id, corePatientId);
  await setJourney(admin, account.id, 'id_verified', null);
  return { accountId: account.id, corePatientId };
}

// Walk a fresh patient all the way to `delivered` via the fast lane (intake ->
// approve -> dispense -> mock status walk), so membership can advance the spec's
// delivered -> active_member transition.
async function patientAtDelivered(): Promise<{ accountId: string; corePatientId: string }> {
  const clinicianId = await freshClinician();
  const { accountId, corePatientId } = await freshPatient();
  await submitIntake(admin, core, accountId, corePatientId, 'menopause', fastLaneAnswers());
  const { data } = await admin.from('queue_item').select('*').eq('account_id', accountId).single();
  const decision = await decideClinicianAction(admin, core, {
    clinicianAccountId: clinicianId,
    queueItemId: data.id,
    action: 'approve',
    reason: 'Clear continuing picture.',
    rxItems: [{ name: 'Transdermal HRT', dose: 'as directed', quantity: 1 }],
  });
  await dispenseIssuedScript(admin, core, dispensing, {
    accountId,
    corePatientId,
    rxId: decision.rxId!,
  });
  await advanceDispensing(admin, dispensing, accountId, new Date().toISOString()); // dispatched
  await advanceDispensing(admin, dispensing, accountId, new Date().toISOString()); // delivered
  return { accountId, corePatientId };
}

// Drive a mock checkout the way the routes do: start it, pull the session id from
// the returned mock URL, mark it paid (the provider's side), then finalise.
function sessionIdFromClientUrl(clientUrl: string): string {
  return new URL(clientUrl, 'https://x').searchParams.get('session')!;
}

async function payMock(kind: 'consult' | 'membership', accountId: string): Promise<void> {
  const clientUrl = await startCheckout(admin, payments, kind, accountId, '/account/billing/complete');
  const sessionId = sessionIdFromClientUrl(clientUrl);
  await payments.markPaid(sessionId);
  await finaliseLatestPending(admin, payments, accountId);
}

afterAll(async () => {
  if (createdAccounts.length === 0) return;
  // Bulk deletes (two queries) so cleanup stays inside the hook timeout.
  await admin.from('mock_payment_session').delete().in('account_id', createdAccounts);
  // Account delete cascades journey / queue_item / payment_ref / membership / dispense_ref.
  await admin.from('account').delete().in('id', createdAccounts);
});

// ===========================================================================
// Success test #1: paying the consult fee (test mode) flips the consult gate
// the full-lane booking (P6) consults.
// ===========================================================================
describe('consult fee: paying it flips the hasPaidConsult gate', () => {
  it('starts unpaid, records a pending pointer, and is paid after the mock checkout', async () => {
    const { accountId } = await freshPatient();
    expect(await hasPaidConsult(admin, accountId)).toBe(false);

    const clientUrl = await startCheckout(admin, payments, 'consult', accountId, '/r');
    expect(clientUrl).toContain('/account/billing/mock');

    // Pending pointer recorded; not yet paid (no card data stored, just a pointer).
    expect(await hasPaidConsult(admin, accountId)).toBe(false);

    const sessionId = sessionIdFromClientUrl(clientUrl);
    await payments.markPaid(sessionId);
    const result = await finaliseLatestPending(admin, payments, accountId);
    expect(result).toEqual({ kind: 'consult', complete: true });

    expect(await hasPaidConsult(admin, accountId)).toBe(true);
  });
});

// ===========================================================================
// Success test #2: subscribing creates an active_member.
// ===========================================================================
describe('membership: subscribing activates membership and advances to active_member', () => {
  it('a delivered patient who subscribes advances delivered -> active_member', { timeout: 60_000 }, async () => {
    const { accountId } = await patientAtDelivered();
    expect((await getJourney(admin, accountId))?.state).toBe('delivered');
    expect(await isActiveMember(admin, accountId)).toBe(false);

    await payMock('membership', accountId);

    expect(await isActiveMember(admin, accountId)).toBe(true);
    const membership = await getMembership(admin, accountId);
    expect(membership?.status).toBe('active');
    expect(membership?.provider_customer_ref).toBeTruthy();
    expect(membership?.provider_subscription_ref).toBeTruthy();

    // Spec-exact transition: delivered -> active_member.
    expect((await getJourney(admin, accountId))?.state).toBe('active_member');
  });

  it('finalisation is idempotent: re-finalising does not throw or double-advance', { timeout: 60_000 }, async () => {
    const { accountId } = await patientAtDelivered();
    await payMock('membership', accountId);
    // A second poll (webhook + return page can both fire) is a no-op.
    await finaliseLatestPending(admin, payments, accountId);
    expect((await getJourney(admin, accountId))?.state).toBe('active_member');
  });
});

// ===========================================================================
// Success test #3: a member's repeat reaches the review queue with NO new
// consult charge; a non-member cannot ride free.
// ===========================================================================
describe('repeat tiering: members ride free, non-members are gated', () => {
  it('an active member lodges a repeat that enters the queue with no consult charge', { timeout: 60_000 }, async () => {
    const { accountId, corePatientId } = await patientAtDelivered();
    await payMock('membership', accountId);
    expect(await isActiveMember(admin, accountId)).toBe(true);

    const { queueItemId } = await lodgeRepeatRequest(admin, core, accountId, corePatientId);

    // The repeat is now a pending fast-lane item. (The global queue may hold items
    // from other concurrently-running tests, so assert this item is present rather
    // than an exact count.)
    const queue = await listPendingFastQueue(admin);
    expect(queue.some((q) => q.id === queueItemId)).toBe(true);

    // No NEW consult charge was raised for the repeat: the only consult-kind
    // payment_ref is none (the member never paid a consult here). The repeat is
    // membership-covered.
    const { data: consultPayments } = await admin
      .from('payment_ref')
      .select('*')
      .eq('account_id', accountId)
      .eq('kind', 'consult');
    expect(consultPayments?.length ?? 0).toBe(0);

    // Hard line: lodging a repeat issues NO script (clinician still decides).
    expect(await core.getPrescriptions(corePatientId)).toHaveLength(1);
  });

  it('a NON-member cannot lodge a no-charge repeat', { timeout: 60_000 }, async () => {
    const { accountId, corePatientId } = await patientAtDelivered();
    expect(await isActiveMember(admin, accountId)).toBe(false);
    await expect(
      lodgeRepeatRequest(admin, core, accountId, corePatientId),
    ).rejects.toThrow(/active membership/i);
  });
});

// ===========================================================================
// Success test #4: cancelling updates membership state (loses member access).
// ===========================================================================
describe('cancel: a portal cancel flips membership to canceled', () => {
  it('cancelling deactivates membership and revokes the no-charge repeat', { timeout: 60_000 }, async () => {
    const { accountId, corePatientId } = await patientAtDelivered();
    await payMock('membership', accountId);
    const membership = await getMembership(admin, accountId);

    await finaliseMembershipCancel(admin, membership!.provider_customer_ref!);

    expect(await isActiveMember(admin, accountId)).toBe(false);
    expect((await getMembership(admin, accountId))?.status).toBe('canceled');

    // A cancelled member can no longer lodge a no-charge repeat.
    await expect(
      lodgeRepeatRequest(admin, core, accountId, corePatientId),
    ).rejects.toThrow(/active membership/i);
  });
});

// ===========================================================================
// HARD LINE made executable: the membership table holds NO card data / PII —
// only provider pointers + a coarse status. Mirrors the P4 dispense_ref denylist.
// ===========================================================================
describe('P5 hard line: membership holds no card data / PII, only pointers + status', () => {
  const DENYLIST = /card|cvc|cvv|pan|number|name|address|email|phone|dob|amount|price/i;

  it('membership has exactly {id, account_id, provider_customer_ref, provider_subscription_ref, status, created_at, updated_at}', { timeout: 60_000 }, async () => {
    const { accountId } = await patientAtDelivered();
    await payMock('membership', accountId);

    const { data, error } = await admin
      .from('membership')
      .select('*')
      .eq('account_id', accountId)
      .single();
    expect(error).toBeFalsy();

    const cols = Object.keys(data!).sort();
    expect(cols).toEqual([
      'account_id',
      'created_at',
      'id',
      'provider_customer_ref',
      'provider_subscription_ref',
      'status',
      'updated_at',
    ]);
    for (const col of cols) {
      expect(col, `membership.${col} looks like card data / PII`).not.toMatch(DENYLIST);
    }
  });
});
