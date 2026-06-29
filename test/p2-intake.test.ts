import { afterAll, describe, expect, it } from 'vitest';
import { readEnv } from '../src/lib/env';
import { createAdminClient } from '../src/lib/supabase/admin';
import { MockCore } from '../src/lib/adapters/mock-core';
import { routeIntake, type IntakeAnswers } from '../src/lib/intake/routing';
import { submitIntake } from '../src/lib/intake/submit';
import {
  ensureAccount,
  getJourney,
  getLatestIntakeRef,
  setCorePatientId,
  setJourney,
} from '../src/lib/accounts';

// A baseline "clear, continuing, no flags" answer set. Each test overrides only
// the fields it is exercising, so the routing precedence is unambiguous.
function answers(overrides: Partial<IntakeAnswers> = {}): IntakeAnswers {
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
    ...overrides,
  };
}

// ===========================================================================
// Pure routing engine — deterministic, no DB. This is the load-bearing logic.
// ===========================================================================
describe('routeIntake: deterministic two-lane routing + red-flag stops', () => {
  it('routes a clear, continuing picture with no flags to the FAST lane', () => {
    const d = routeIntake(answers());
    expect(d.outcome).toBe('fast');
    expect(d.lane).toBe('fast');
    expect(d.signpost).toBeNull();
  });

  it('routes HRT initiation (first time) to the FULL lane by rule', () => {
    const d = routeIntake(answers({ treatmentHistory: 'initiation' }));
    expect(d.outcome).toBe('full');
    expect(d.lane).toBe('full');
    expect(d.reasons.join(' ')).toMatch(/first time/i);
  });

  it('routes any risk flag (clot history, breast cancer, liver) to the FULL lane', () => {
    expect(routeIntake(answers({ clotHistory: true })).outcome).toBe('full');
    expect(routeIntake(answers({ breastCancerHistory: true })).outcome).toBe('full');
    expect(routeIntake(answers({ liverDisease: true })).outcome).toBe('full');
  });

  it('routes a raised BP to the FULL lane, and a crisis BP to a STOP', () => {
    expect(routeIntake(answers({ bpSystolic: 150, bpDiastolic: 95 })).outcome).toBe('full');
    const crisis = routeIntake(answers({ bpSystolic: 185, bpDiastolic: 125 }));
    expect(crisis.outcome).toBe('stop');
    expect(crisis.signpost?.service).toMatch(/111/);
  });

  it('routes an incomplete safety picture (no symptoms, or missing BP) to the FULL lane', () => {
    expect(routeIntake(answers({ symptoms: [] })).outcome).toBe('full');
    expect(routeIntake(answers({ bpSystolic: null, bpDiastolic: null })).outcome).toBe('full');
  });

  it('STOPS and signposts on a red-flag answer (no lane assigned)', () => {
    const bleed = routeIntake(answers({ unexplainedBleeding: true }));
    expect(bleed.outcome).toBe('stop');
    expect(bleed.lane).toBeNull();
    expect(bleed.signpost?.service).toMatch(/GP/i);

    const clotSymptoms = routeIntake(answers({ suspectedClotSymptoms: true }));
    expect(clotSymptoms.outcome).toBe('stop');
    expect(clotSymptoms.signpost?.service).toMatch(/111/); // acute -> urgent signpost
  });

  it('PRECEDENCE: a red flag stops even when every other answer would route to a lane', () => {
    // Would otherwise be fast.
    expect(routeIntake(answers({ currentPregnancy: true })).outcome).toBe('stop');
    // Would otherwise be full (initiation + risk flag) — the red flag still wins.
    const d = routeIntake(
      answers({ treatmentHistory: 'initiation', clotHistory: true, undiagnosedBreastLump: true }),
    );
    expect(d.outcome).toBe('stop');
    expect(d.lane).toBeNull();
  });

  it('never returns a prescribing instruction or a diagnosis (outcome is a route only)', () => {
    for (const d of [
      routeIntake(answers()),
      routeIntake(answers({ treatmentHistory: 'initiation' })),
      routeIntake(answers({ unexplainedBleeding: true })),
    ]) {
      expect(['fast', 'full', 'stop']).toContain(d.outcome);
      // The decision carries reasons + an optional signpost, nothing prescriptive.
      expect(Object.keys(d).sort()).toEqual(['lane', 'outcome', 'reasons', 'signpost']);
    }
  });
});

// ===========================================================================
// DB-backed submit — proves the app-DB writes, the core write, and the journey
// transitions for each outcome. Uses throwaway accounts forced to id_verified.
// ===========================================================================
const env = { ...readEnv(), CORE_IMPL: 'mock', IDENTITY_IMPL: 'mock' };
const admin = createAdminClient(env);
const core = new MockCore(admin);
const createdAccounts: string[] = [];

async function freshVerifiedAccount(): Promise<{ accountId: string; corePatientId: string }> {
  const account = await ensureAccount(admin, crypto.randomUUID());
  createdAccounts.push(account.id);
  const corePatientId = await core.createPatient({ fullName: 'P2 Test' });
  await setCorePatientId(admin, account.id, corePatientId);
  // Force the journey to the ID gate (setJourney bypasses the machine, fixture only).
  await setJourney(admin, account.id, 'id_verified', null);
  return { accountId: account.id, corePatientId };
}

afterAll(async () => {
  for (const id of createdAccounts) {
    await admin.from('account').delete().eq('id', id); // cascades journey / intake_ref / queue_item
  }
});

describe('submitIntake: writes answers to the core, routes, and advances the journey', () => {
  it('FAST lane: saves to the core, advances to in_review_queue, creates a queue_item pointer', async () => {
    const { accountId, corePatientId } = await freshVerifiedAccount();
    const { intakeId, decision } = await submitIntake(
      admin,
      core,
      accountId,
      corePatientId,
      'menopause',
      answers(),
    );
    expect(decision.outcome).toBe('fast');

    // The ANSWERS live in the core and are readable back via the adapter.
    const intake = await core.getIntake(intakeId);
    expect(intake?.corePatientId).toBe(corePatientId);
    expect((intake?.payload.answers as unknown as IntakeAnswers).treatmentHistory).toBe('continuing');

    // Journey advanced to in_review_queue on the fast lane.
    const journey = await getJourney(admin, accountId);
    expect(journey?.state).toBe('in_review_queue');
    expect(journey?.lane).toBe('fast');

    // app DB: intake_ref records the outcome; a queue_item pointer exists.
    expect((await getLatestIntakeRef(admin, accountId))?.outcome).toBe('fast');
    const { data: queue } = await admin.from('queue_item').select('*').eq('account_id', accountId);
    expect(queue).toHaveLength(1);
    expect(queue![0].intake_id).toBe(intakeId);
  });

  it('FULL lane (seeded risk flag): routes full, stays at intake_submitted, NO queue_item', async () => {
    const { accountId, corePatientId } = await freshVerifiedAccount();
    const { decision } = await submitIntake(
      admin,
      core,
      accountId,
      corePatientId,
      'menopause',
      answers({ clotHistory: true }),
    );
    expect(decision.outcome).toBe('full');

    const journey = await getJourney(admin, accountId);
    expect(journey?.state).toBe('intake_submitted');
    expect(journey?.lane).toBe('full');

    expect((await getLatestIntakeRef(admin, accountId))?.outcome).toBe('full');
    const { data: queue } = await admin.from('queue_item').select('*').eq('account_id', accountId);
    expect(queue).toHaveLength(0); // the full lane is not an async review
  });

  it('STOP (red flag): records the stop, assigns no lane, no queue_item', async () => {
    const { accountId, corePatientId } = await freshVerifiedAccount();
    const { intakeId, decision } = await submitIntake(
      admin,
      core,
      accountId,
      corePatientId,
      'menopause',
      answers({ unexplainedBleeding: true }),
    );
    expect(decision.outcome).toBe('stop');
    expect(decision.signpost).not.toBeNull();

    // The intake (including the red-flag answers) is still recorded in the core.
    const intake = await core.getIntake(intakeId);
    expect((intake?.payload.answers as unknown as IntakeAnswers).unexplainedBleeding).toBe(true);

    const journey = await getJourney(admin, accountId);
    expect(journey?.state).toBe('intake_submitted');
    expect(journey?.lane).toBeNull();

    expect((await getLatestIntakeRef(admin, accountId))?.outcome).toBe('stop');
    const { data: queue } = await admin.from('queue_item').select('*').eq('account_id', accountId);
    expect(queue).toHaveLength(0);
  });

  it('HARD LINE: submitIntake never advances past in_review_queue (no auto-approve / auto-script)', async () => {
    const { accountId, corePatientId } = await freshVerifiedAccount();
    await submitIntake(admin, core, accountId, corePatientId, 'menopause', answers());
    const journey = await getJourney(admin, accountId);
    // The furthest any questionnaire-only path reaches is the review queue; a
    // clinician action (P3) is required to move beyond it.
    expect(['intake_submitted', 'in_review_queue']).toContain(journey?.state);
    expect(journey?.state).not.toBe('approved');
    expect(journey?.state).not.toBe('rx_issued');
  });
});

// ===========================================================================
// HARD LINE made executable: the app DB holds NO clinical answers — only a
// pointer + the routing outcome. Mirrors the P1 PII-denylist structural test.
// ===========================================================================
describe('P2 hard line: intake_ref holds no clinical answers, only a pointer + outcome', () => {
  const DENYLIST =
    /answer|symptom|bleed|clot|cancer|pregnan|breast|liver|diagnosis|systolic|diastolic|bp_|reason|note/i;

  it('intake_ref has exactly {id, account_id, intake_id, outcome, status, created_at}', async () => {
    const { accountId, corePatientId } = await freshVerifiedAccount();
    await submitIntake(admin, core, accountId, corePatientId, 'menopause', answers());

    const { data, error } = await admin
      .from('intake_ref')
      .select('*')
      .eq('account_id', accountId)
      .single();
    expect(error).toBeFalsy();

    const cols = Object.keys(data!).sort();
    expect(cols).toEqual(['account_id', 'created_at', 'id', 'intake_id', 'outcome', 'status']);
    for (const col of cols) {
      expect(col, `intake_ref.${col} looks like clinical/answer data`).not.toMatch(DENYLIST);
    }
  });
});
