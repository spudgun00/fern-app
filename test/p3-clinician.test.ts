import { afterAll, describe, expect, it } from 'vitest';
import { readEnv } from '../src/lib/env';
import { createAdminClient } from '../src/lib/supabase/admin';
import { MockCore } from '../src/lib/adapters/mock-core';
import { submitIntake } from '../src/lib/intake/submit';
import { decideClinicianAction } from '../src/lib/clinician/decide';
import type { IntakeAnswers } from '../src/lib/intake/routing';
import {
  ensureAccount,
  getJourney,
  getQueueItemById,
  setCorePatientId,
  setJourney,
  type QueueItem,
} from '../src/lib/accounts';

// A clear, continuing, no-flags answer set — routes to the fast lane (so a
// queue_item exists for the clinician to decide).
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

const env = { ...readEnv(), CORE_IMPL: 'mock', IDENTITY_IMPL: 'mock' };
const admin = createAdminClient(env);
const core = new MockCore(admin);
const createdAccounts: string[] = [];

async function freshClinician(): Promise<string> {
  const account = await ensureAccount(admin, crypto.randomUUID());
  createdAccounts.push(account.id);
  const { error } = await admin.from('account').update({ role: 'clinician' }).eq('id', account.id);
  if (error) throw new Error(error.message);
  return account.id;
}

// A fresh verified patient who has submitted a fast-lane intake: returns the
// account id, the core patient id, and the pending queue_item awaiting review.
async function patientInReviewQueue(): Promise<{
  accountId: string;
  corePatientId: string;
  queueItem: QueueItem;
}> {
  const account = await ensureAccount(admin, crypto.randomUUID());
  createdAccounts.push(account.id);
  const corePatientId = await core.createPatient({ fullName: 'P3 Test Patient' });
  await setCorePatientId(admin, account.id, corePatientId);
  await setJourney(admin, account.id, 'id_verified', null); // fixture: force the ID gate
  await submitIntake(admin, core, account.id, corePatientId, 'menopause', fastLaneAnswers());

  const { data } = await admin
    .from('queue_item')
    .select('*')
    .eq('account_id', account.id)
    .single();
  return { accountId: account.id, corePatientId, queueItem: data as QueueItem };
}

afterAll(async () => {
  for (const id of createdAccounts) {
    await admin.from('account').delete().eq('id', id); // cascades journey / intake_ref / queue_item
  }
});

describe('decideClinicianAction: the clinician closes the fast lane', () => {
  it('APPROVE: issues a (mock) script and advances the patient to rx_issued', async () => {
    const clinicianId = await freshClinician();
    const { accountId, corePatientId, queueItem } = await patientInReviewQueue();

    const result = await decideClinicianAction(admin, core, {
      clinicianAccountId: clinicianId,
      queueItemId: queueItem.id,
      action: 'approve',
      reason: 'Clear continuing picture, no contraindications. Approve transdermal HRT.',
      rxItems: [{ name: 'Transdermal HRT', dose: 'as directed', quantity: 1 }],
    });

    expect(result.newState).toBe('rx_issued');
    expect(result.rxId).toBeTruthy();

    // Journey advanced to rx_issued.
    expect((await getJourney(admin, accountId))?.state).toBe('rx_issued');

    // The script lives in the CORE and is clinician-issued from a decision state.
    const scripts = await core.getPrescriptions(corePatientId);
    expect(scripts).toHaveLength(1);
    expect(scripts[0].request.decisionState).toBe('approved');
    expect(scripts[0].request.clinicianRef).toBe(clinicianId);

    // App DB: the queue_item carries the decision audit pointers only.
    const decided = await getQueueItemById(admin, queueItem.id);
    expect(decided?.status).toBe('approved');
    expect(decided?.decided_by).toBe(clinicianId);
    expect(decided?.decided_at).toBeTruthy();
    expect(decided?.note_ref).toBeTruthy();
    expect(decided?.rx_ref).toBe(result.rxId);
  });

  it('ESCALATE: moves the patient into the full lane, issues NO script', async () => {
    const clinicianId = await freshClinician();
    const { accountId, corePatientId, queueItem } = await patientInReviewQueue();

    const result = await decideClinicianAction(admin, core, {
      clinicianAccountId: clinicianId,
      queueItemId: queueItem.id,
      action: 'escalate',
      reason: 'Needs an assessed consult before any prescribing.',
    });

    expect(result.newState).toBe('escalated');
    expect(result.rxId).toBeNull();

    const journey = await getJourney(admin, accountId);
    expect(journey?.state).toBe('escalated');
    expect(journey?.lane).toBe('full');

    // No script was issued on escalate (no auto-script).
    expect(await core.getPrescriptions(corePatientId)).toHaveLength(0);

    const decided = await getQueueItemById(admin, queueItem.id);
    expect(decided?.status).toBe('escalated');
    expect(decided?.rx_ref).toBeNull();
    expect(decided?.note_ref).toBeTruthy();
  });

  it('REFUSE: terminates with a recorded reason, issues NO script', async () => {
    const clinicianId = await freshClinician();
    const { accountId, corePatientId, queueItem } = await patientInReviewQueue();

    const result = await decideClinicianAction(admin, core, {
      clinicianAccountId: clinicianId,
      queueItemId: queueItem.id,
      action: 'refuse',
      reason: 'Outside the service scope; signpost to GP.',
    });

    expect(result.newState).toBe('refused');
    expect(result.rxId).toBeNull();
    expect((await getJourney(admin, accountId))?.state).toBe('refused');
    expect(await core.getPrescriptions(corePatientId)).toHaveLength(0);
    expect((await getQueueItemById(admin, queueItem.id))?.status).toBe('refused');
  });
});

// ===========================================================================
// HARD LINE made executable: no script without a clinician action, and every
// decision records a clinician + reason.
// ===========================================================================
describe('P3 hard line: rx_issued is reachable ONLY via a clinician action', () => {
  it('a NON-clinician actor cannot decide (no patient-role bypass)', async () => {
    const { accountId, queueItem } = await patientInReviewQueue();
    // The patient's own account is role patient -> rejected as an actor.
    await expect(
      decideClinicianAction(admin, core, {
        clinicianAccountId: accountId,
        queueItemId: queueItem.id,
        action: 'approve',
        reason: 'attempting self-approval',
        rxItems: [{ name: 'x' }],
      }),
    ).rejects.toThrow(/only a clinician/i);
    // Journey did not move past the queue.
    expect((await getJourney(admin, accountId))?.state).toBe('in_review_queue');
  });

  it('a decision REQUIRES a recorded reason', async () => {
    const clinicianId = await freshClinician();
    const { queueItem } = await patientInReviewQueue();
    await expect(
      decideClinicianAction(admin, core, {
        clinicianAccountId: clinicianId,
        queueItemId: queueItem.id,
        action: 'approve',
        reason: '   ',
        rxItems: [{ name: 'x' }],
      }),
    ).rejects.toThrow(/reason/i);
  });

  it('APPROVE requires at least one prescription item (no empty script)', async () => {
    const clinicianId = await freshClinician();
    const { queueItem } = await patientInReviewQueue();
    await expect(
      decideClinicianAction(admin, core, {
        clinicianAccountId: clinicianId,
        queueItemId: queueItem.id,
        action: 'approve',
        reason: 'approve',
        rxItems: [],
      }),
    ).rejects.toThrow(/at least one prescription item/i);
  });

  it('an already-decided item cannot be decided again', async () => {
    const clinicianId = await freshClinician();
    const { queueItem } = await patientInReviewQueue();
    await decideClinicianAction(admin, core, {
      clinicianAccountId: clinicianId,
      queueItemId: queueItem.id,
      action: 'refuse',
      reason: 'first decision',
    });
    await expect(
      decideClinicianAction(admin, core, {
        clinicianAccountId: clinicianId,
        queueItemId: queueItem.id,
        action: 'approve',
        reason: 'second decision',
        rxItems: [{ name: 'x' }],
      }),
    ).rejects.toThrow(/already decided/i);
  });
});
