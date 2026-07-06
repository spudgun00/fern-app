import { afterAll, describe, expect, it } from 'vitest';
import { readEnv } from '../src/lib/env';
import { createAdminClient } from '../src/lib/supabase/admin';
import { MockCore } from '../src/lib/adapters/mock-core';
import { MockDispensing } from '../src/lib/adapters/mock-dispensing';
import { submitIntake } from '../src/lib/intake/submit';
import { decideClinicianAction } from '../src/lib/clinician/decide';
import { advanceDispensing, dispenseIssuedScript } from '../src/lib/dispensing/dispense';
import { RX_ISSUED_PREDECESSORS } from '../src/lib/journey/machine';
import type { IntakeAnswers } from '../src/lib/intake/routing';
import {
  ensureAccount,
  getJourney,
  setCorePatientId,
  setJourney,
} from '../src/lib/accounts';

// ===========================================================================
// Phase F (demo clinician loop) — a reviewer, acting as the mock clinician,
// approves a pending patient and the patient completes the loop to DELIVERED,
// all without a real doctor. This proves the loop end to end at the lib level
// (config-independent) and re-asserts the hard line: rx_issued is reached ONLY
// through the clinician Approve action, and its predecessors are unchanged.
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

afterAll(async () => {
  for (const id of createdAccounts) {
    await admin.from('account').delete().eq('id', id);
  }
});

describe('DEMO_AUTO_APPROVE flag', () => {
  it('is OFF by default and ON only when explicitly "true"', () => {
    expect(readEnv({ DEMO_AUTO_APPROVE: undefined }).DEMO_AUTO_APPROVE).toBe(false);
    expect(readEnv({ DEMO_AUTO_APPROVE: 'false' }).DEMO_AUTO_APPROVE).toBe(false);
    expect(readEnv({ DEMO_AUTO_APPROVE: 'true' }).DEMO_AUTO_APPROVE).toBe(true);
  });
});

describe('the demo clinician loop: approve (mock clinician) -> dispensing -> delivered', () => {
  it('completes the whole loop, with rx_issued reached only via the clinician action', async () => {
    // A fast-lane patient sitting in the review queue (as a persona lands them).
    const clinicianId = await freshClinician();
    const patient = await ensureAccount(admin, crypto.randomUUID());
    createdAccounts.push(patient.id);
    const corePatientId = await core.createPatient({ fullName: 'Phase F Patient' });
    await setCorePatientId(admin, patient.id, corePatientId);
    await setJourney(admin, patient.id, 'id_verified', null);
    await submitIntake(admin, core, patient.id, corePatientId, 'menopause', fastLaneAnswers());
    expect((await getJourney(admin, patient.id))?.state).toBe('in_review_queue');

    // Before any clinician action there is NO script.
    expect((await core.getPrescriptions(corePatientId)).length).toBe(0);

    // The reviewer, acting as the clinician, Approves + issues.
    const { data: qi } = await admin
      .from('queue_item')
      .select('*')
      .eq('account_id', patient.id)
      .single();
    const decision = await decideClinicianAction(admin, core, {
      clinicianAccountId: clinicianId,
      queueItemId: qi.id,
      action: 'approve',
      reason: 'Clear continuing picture, no contraindications.',
      rxItems: [{ name: 'Transdermal HRT (as assessed)', dose: 'as directed', quantity: 1 }],
    });
    expect(decision.rxId).toBeTruthy();
    // Approve stops at rx_issued (the clinical decision); a script now exists.
    expect((await getJourney(admin, patient.id))?.state).toBe('rx_issued');
    expect((await core.getPrescriptions(corePatientId)).length).toBe(1);

    // The issued script flows to the (mock) pharmacy: rx_issued -> dispensing.
    await dispenseIssuedScript(admin, core, dispensing, {
      accountId: patient.id,
      corePatientId,
      rxId: decision.rxId!,
    });
    expect((await getJourney(admin, patient.id))?.state).toBe('dispensing');

    // The reviewer steps the mock dispensing to delivered (the /api/demo affordance),
    // and the patient view completes: dispensing -> delivered.
    let status: string | null = null;
    for (let i = 0; i < 5 && status !== 'delivered'; i++) {
      status = await advanceDispensing(admin, dispensing, patient.id, new Date().toISOString());
    }
    expect(status).toBe('delivered');
    expect((await getJourney(admin, patient.id))?.state).toBe('delivered');
  });

  it('HARD LINE unchanged: rx_issued is reachable only from approved | consult_done', () => {
    expect([...RX_ISSUED_PREDECESSORS].sort()).toEqual(['approved', 'consult_done']);
  });
});
