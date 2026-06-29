import { afterAll, describe, expect, it } from 'vitest';
import { readEnv } from '../src/lib/env';
import { createAdminClient } from '../src/lib/supabase/admin';
import { MockCore } from '../src/lib/adapters/mock-core';
import { MockDispensing } from '../src/lib/adapters/mock-dispensing';
import { submitIntake } from '../src/lib/intake/submit';
import { decideClinicianAction } from '../src/lib/clinician/decide';
import {
  advanceDispensing,
  dispenseIssuedScript,
  getTreatmentView,
  lodgeRepeatRequest,
} from '../src/lib/dispensing/dispense';
import type { IntakeAnswers } from '../src/lib/intake/routing';
import {
  ensureAccount,
  getJourney,
  getLatestDispenseRef,
  listPendingFastQueue,
  setCorePatientId,
  setJourney,
  upsertMembership,
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

const env = { ...readEnv(), CORE_IMPL: 'mock', DISPENSING_IMPL: 'mock', IDENTITY_IMPL: 'mock' };
const admin = createAdminClient(env);
const core = new MockCore(admin);
const dispensing = new MockDispensing(admin);
const createdAccounts: string[] = [];

async function freshClinician(): Promise<string> {
  const account = await ensureAccount(admin, crypto.randomUUID());
  createdAccounts.push(account.id);
  const { error } = await admin.from('account').update({ role: 'clinician' }).eq('id', account.id);
  if (error) throw new Error(error.message);
  return account.id;
}

// A fresh patient who has been through the fast lane and had a clinician APPROVE
// their intake: the script is issued in the core and the journey sits at
// rx_issued (decideClinicianAction stops there; dispensing is the P4 step).
async function patientWithIssuedScript(): Promise<{
  accountId: string;
  corePatientId: string;
  rxId: string;
}> {
  const clinicianId = await freshClinician();
  const account = await ensureAccount(admin, crypto.randomUUID());
  createdAccounts.push(account.id);
  const corePatientId = await core.createPatient({ fullName: 'P4 Test Patient' });
  await setCorePatientId(admin, account.id, corePatientId);
  await setJourney(admin, account.id, 'id_verified', null);
  await submitIntake(admin, core, account.id, corePatientId, 'menopause', fastLaneAnswers());

  const { data } = await admin.from('queue_item').select('*').eq('account_id', account.id).single();
  const result = await decideClinicianAction(admin, core, {
    clinicianAccountId: clinicianId,
    queueItemId: data.id,
    action: 'approve',
    reason: 'Clear continuing picture, no contraindications.',
    rxItems: [{ name: 'Transdermal HRT', dose: 'as directed', quantity: 1 }],
  });
  return { accountId: account.id, corePatientId, rxId: result.rxId! };
}

afterAll(async () => {
  for (const id of createdAccounts) {
    await admin.from('account').delete().eq('id', id); // cascades journey / queue_item / dispense_ref
  }
});

describe('dispenseIssuedScript: the issued script flows to dispensing', () => {
  it('submits the script to the pharmacy, records the pointer, and advances rx_issued -> dispensing', async () => {
    const { accountId, corePatientId, rxId } = await patientWithIssuedScript();
    expect((await getJourney(admin, accountId))?.state).toBe('rx_issued');

    const result = await dispenseIssuedScript(admin, core, dispensing, {
      accountId,
      corePatientId,
      rxId,
    });
    expect(result.dispenseId).toBeTruthy();
    expect(result.status).toBe('submitted');

    // Journey advanced to dispensing.
    expect((await getJourney(admin, accountId))?.state).toBe('dispensing');

    // App DB: the dispense_ref pointer is recorded (pointers + status only).
    const ref = await getLatestDispenseRef(admin, accountId);
    expect(ref?.rx_ref).toBe(rxId);
    expect(ref?.dispense_id).toBe(result.dispenseId);
    expect(ref?.status).toBe('submitted');

    // The dispensing provider holds the submitted record.
    expect((await dispensing.getDispenseStatus(result.dispenseId))?.status).toBe('submitted');
  });

  it('HARD LINE: a script cannot be dispensed unless the patient is at rx_issued', async () => {
    // A fresh patient with a core record but NOT at rx_issued (no clinician action).
    const account = await ensureAccount(admin, crypto.randomUUID());
    createdAccounts.push(account.id);
    const corePatientId = await core.createPatient({ fullName: 'P4 No Script' });
    await setCorePatientId(admin, account.id, corePatientId);
    await setJourney(admin, account.id, 'in_review_queue', 'fast');

    // Even with a fabricated rxId, the journey machine bars dispensing: there is
    // no rx_issued to move from. (And no such script exists in the core.)
    await expect(
      dispenseIssuedScript(admin, core, dispensing, {
        accountId: account.id,
        corePatientId,
        rxId: crypto.randomUUID(),
      }),
    ).rejects.toThrow();
    expect((await getJourney(admin, account.id))?.state).toBe('in_review_queue');
  });
});

describe('mock dispensing status: submitted -> dispatched -> delivered reflects on the patient view', () => {
  it('advances the mock through to delivered and completes the journey', { timeout: 60_000 }, async () => {
    const { accountId, corePatientId, rxId } = await patientWithIssuedScript();
    await dispenseIssuedScript(admin, core, dispensing, { accountId, corePatientId, rxId });

    // submitted -> dispatched (journey stays dispensing).
    let next = await advanceDispensing(admin, dispensing, accountId, new Date().toISOString());
    expect(next).toBe('dispatched');
    expect((await getJourney(admin, accountId))?.state).toBe('dispensing');
    expect((await getLatestDispenseRef(admin, accountId))?.status).toBe('dispatched');

    // dispatched -> delivered (journey dispensing -> delivered).
    next = await advanceDispensing(admin, dispensing, accountId, new Date().toISOString());
    expect(next).toBe('delivered');
    expect((await getJourney(admin, accountId))?.state).toBe('delivered');
    expect((await getLatestDispenseRef(admin, accountId))?.status).toBe('delivered');

    // delivered is terminal for the mock: a further advance is a no-op.
    next = await advanceDispensing(admin, dispensing, accountId, new Date().toISOString());
    expect(next).toBe('delivered');

    // The patient treatment view reflects the script, the delivered status, and
    // a tracking trail with both events.
    const view = await getTreatmentView(admin, core, dispensing, accountId, corePatientId);
    expect(view.script?.id).toBe(rxId);
    expect(view.status?.status).toBe('delivered');
    expect((view.tracking?.events.length ?? 0)).toBeGreaterThanOrEqual(2);
    // A dispense exists (the repeat entry is gated on membership in P5, so this
    // non-member sees the dispensed script but is not yet offered a repeat).
    expect(Boolean(view.dispense)).toBe(true);
    expect(view.isMember).toBe(false);
    expect(view.canRequestRepeat).toBe(false);
  });
});

describe('repeat request: a member lodges a repeat that enters the review queue', () => {
  it('writes a core repeat request and creates a pending fast-lane queue_item', { timeout: 60_000 }, async () => {
    const { accountId, corePatientId, rxId } = await patientWithIssuedScript();
    await dispenseIssuedScript(admin, core, dispensing, { accountId, corePatientId, rxId });

    // P5 tiering: a no-charge repeat requires an active membership. Grant it.
    await upsertMembership(admin, accountId, {
      status: 'active',
      providerCustomerRef: 'mock_cus_p4',
      providerSubscriptionRef: 'mock_sub_p4',
    });

    const { requestId, queueItemId } = await lodgeRepeatRequest(admin, core, accountId, corePatientId);
    expect(requestId).toBeTruthy();
    expect(queueItemId).toBeTruthy();

    // The repeat is now a pending fast-lane item in the clinician queue. (The
    // global queue may hold items from other concurrently-running tests, so assert
    // this item is present rather than an exact count.)
    const queue = await listPendingFastQueue(admin);
    expect(queue.some((q) => q.id === queueItemId)).toBe(true);

    // The hard line holds: lodging a repeat issues NO script on its own (the
    // clinician still decides). Only one script exists in the core.
    expect(await core.getPrescriptions(corePatientId)).toHaveLength(1);
  });
});

// ===========================================================================
// HARD LINE made executable: the app DB holds NO clinical dispensing detail —
// only pointers + a coarse status. Mirrors the P2 intake_ref denylist test.
// ===========================================================================
describe('P4 hard line: dispense_ref holds no clinical content, only pointers + status', () => {
  const DENYLIST = /medicine|drug|dose|dosage|name|quantity|answer|symptom|diagnosis|reason|note|item/i;

  it('dispense_ref has exactly {id, account_id, rx_ref, dispense_id, status, created_at, updated_at}', { timeout: 60_000 }, async () => {
    const { accountId, corePatientId, rxId } = await patientWithIssuedScript();
    await dispenseIssuedScript(admin, core, dispensing, { accountId, corePatientId, rxId });

    const { data, error } = await admin
      .from('dispense_ref')
      .select('*')
      .eq('account_id', accountId)
      .single();
    expect(error).toBeFalsy();

    const cols = Object.keys(data!).sort();
    expect(cols).toEqual([
      'account_id',
      'created_at',
      'dispense_id',
      'id',
      'rx_ref',
      'status',
      'updated_at',
    ]);
    for (const col of cols) {
      expect(col, `dispense_ref.${col} looks like clinical/dispensing detail`).not.toMatch(DENYLIST);
    }
  });
});
