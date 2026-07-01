import { afterAll, describe, expect, it } from 'vitest';
import { readEnv } from '../src/lib/env';
import { createAdminClient } from '../src/lib/supabase/admin';
import { getScreening } from '../src/lib/adapters/factory';
import { MockScreening } from '../src/lib/adapters/mock-screening';
import { MockCore } from '../src/lib/adapters/mock-core';
import { submitIntake } from '../src/lib/intake/submit';
import { decideClinicianAction } from '../src/lib/clinician/decide';
import {
  ALLOWED_TRANSITIONS,
  IllegalTransitionError,
  RX_ISSUED_PREDECESSORS,
  canTransition,
  transition,
} from '../src/lib/journey/machine';
import { JOURNEY_STATES, type JourneyState } from '../src/lib/journey/states';
import {
  ScreeningNotReadyError,
  assertScreeningReadyForDecision,
  screeningPending,
  screeningResultsReady,
} from '../src/lib/screening/guard';
import {
  attachScreeningResults,
  orderScreeningKit,
  receiveScreeningSample,
  routeScreenedToReview,
} from '../src/lib/screening/order';
import {
  ensureAccount,
  getJourney,
  getLatestScreeningRef,
  recordScreeningRef,
  setCorePatientId,
  setJourney,
  setScreeningRefStatus,
  type ScreeningRef,
} from '../src/lib/accounts';
import type { IntakeAnswers } from '../src/lib/intake/routing';

// ===========================================================================
// Weight roadmap P2 — screening before prescribing. Covers: the new journey
// branch (states + transitions), the ScreeningAdapter round-trip via the factory
// flag, the end-to-end screening orchestration, THE GUARD (a prescribing decision
// is blocked until the bloods are in), and the app-DB pointer-only boundary —
// all ALONGSIDE the untouched rx_issued hard line.
// ===========================================================================

// ---- pure machine tests (no DB) -------------------------------------------
describe('journey machine: the screening branch is legal and additive', () => {
  it('walks intake_submitted -> screening_kit_sent -> sample_received -> results_ready -> in_review_queue', () => {
    const path: JourneyState[] = [
      'intake_submitted',
      'screening_kit_sent',
      'sample_received',
      'results_ready',
      'in_review_queue',
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i], path[i + 1]), `${path[i]} -> ${path[i + 1]}`).toBe(true);
      expect(transition(path[i], path[i + 1])).toBe(path[i + 1]);
    }
  });

  it('results_ready can also rejoin the full lane (consult_booked)', () => {
    expect(transition('results_ready', 'consult_booked')).toBe('consult_booked');
  });

  it('leaves the direct (non-screening) menopause forks intact', () => {
    expect(canTransition('intake_submitted', 'in_review_queue')).toBe(true);
    expect(canTransition('intake_submitted', 'consult_booked')).toBe(true);
  });

  it('the screening states cannot skip to a decision or to rx_issued', () => {
    const illegal: Array<[JourneyState, JourneyState]> = [
      ['screening_kit_sent', 'in_review_queue'], // must go via sample_received/results_ready
      ['screening_kit_sent', 'approved'],
      ['sample_received', 'approved'],
      ['results_ready', 'approved'], // results ready still needs the queue + a clinician
      ['screening_kit_sent', 'rx_issued'],
      ['sample_received', 'rx_issued'],
      ['results_ready', 'rx_issued'],
    ];
    for (const [from, to] of illegal) {
      expect(canTransition(from, to), `${from} -> ${to} must be illegal`).toBe(false);
      expect(() => transition(from, to)).toThrow(IllegalTransitionError);
    }
  });

  it('HARD LINE untouched: rx_issued predecessors are still exactly approved + consult_done', () => {
    const predecessors = JOURNEY_STATES.filter((from) =>
      ALLOWED_TRANSITIONS[from].includes('rx_issued'),
    ).sort();
    expect(predecessors).toEqual(['approved', 'consult_done']);
    expect([...RX_ISSUED_PREDECESSORS].sort()).toEqual(['approved', 'consult_done']);
    // The three new screening states are NOT predecessors of rx_issued.
    for (const s of ['screening_kit_sent', 'sample_received', 'results_ready'] as const) {
      expect(canTransition(s, 'rx_issued')).toBe(false);
    }
  });
});

// ---- pure guard tests (no DB) ---------------------------------------------
describe('screening guard (pure): a prescribing decision waits for the bloods', () => {
  const ref = (status: string): ScreeningRef =>
    ({
      id: 'r',
      account_id: 'a',
      kit_ref: 'k',
      status,
      created_at: '',
      updated_at: '',
    }) as ScreeningRef;

  it('no screening_ref -> not a screening patient -> allowed (no-op)', () => {
    expect(screeningPending(null)).toBe(false);
    expect(screeningResultsReady(null)).toBe(false);
    expect(() => assertScreeningReadyForDecision(null)).not.toThrow();
  });

  it('kit_sent / sample_received -> pending -> BLOCKED', () => {
    for (const s of ['kit_sent', 'sample_received']) {
      expect(screeningPending(ref(s))).toBe(true);
      expect(() => assertScreeningReadyForDecision(ref(s))).toThrow(ScreeningNotReadyError);
    }
  });

  it('results_ready -> allowed', () => {
    expect(screeningResultsReady(ref('results_ready'))).toBe(true);
    expect(screeningPending(ref('results_ready'))).toBe(false);
    expect(() => assertScreeningReadyForDecision(ref('results_ready'))).not.toThrow();
  });
});

// ---- integration (Supabase-backed) ----------------------------------------
const env = { ...readEnv(), CORE_IMPL: 'mock', SCREENING_IMPL: 'mock' };
const admin = createAdminClient(env);
const core = new MockCore(admin);
const createdAccounts: string[] = [];

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

async function freshClinician(): Promise<string> {
  const account = await ensureAccount(admin, crypto.randomUUID());
  createdAccounts.push(account.id);
  await admin.from('account').update({ role: 'clinician' }).eq('id', account.id);
  return account.id;
}

// A verified patient at intake_submitted with a core record + a core intake id,
// ready to enter the screening branch.
async function patientAtIntakeSubmitted(): Promise<{
  accountId: string;
  corePatientId: string;
  intakeId: string;
}> {
  const account = await ensureAccount(admin, crypto.randomUUID());
  createdAccounts.push(account.id);
  const corePatientId = await core.createPatient({ fullName: 'Screening Test Patient' });
  await setCorePatientId(admin, account.id, corePatientId);
  await setJourney(admin, account.id, 'intake_submitted', null);
  const intakeId = await core.saveIntake(corePatientId, {
    condition: 'weight',
    lane: 'fast',
    answers: {},
  });
  return { accountId: account.id, corePatientId, intakeId };
}

afterAll(async () => {
  for (const id of createdAccounts) {
    await admin.from('account').delete().eq('id', id); // cascades journey / screening_ref / queue_item
  }
});

describe('ScreeningAdapter round-trip (host-agnostic via SCREENING_IMPL=mock)', () => {
  it('orderKit -> getKitStatus -> advance -> getResults is consistent', { timeout: 60_000 }, async () => {
    const screening = getScreening(env, admin);
    expect(screening).toBeInstanceOf(MockScreening);
    const corePatientId = await core.createPatient({ fullName: 'Kit Roundtrip' });

    const kitId = await screening.orderKit(corePatientId);
    expect(kitId).toBeTruthy();

    const sent = await screening.getKitStatus(kitId);
    expect(sent?.status).toBe('kit_sent');
    // No panel before the bloods are in.
    expect(await screening.getResults(kitId)).toBeNull();

    // Mock-only affordance advances the provider through to results_ready.
    const s1 = await (screening as MockScreening).advanceKit(kitId, new Date().toISOString());
    expect(s1).toBe('sample_received');
    const s2 = await (screening as MockScreening).advanceKit(kitId, new Date().toISOString());
    expect(s2).toBe('results_ready');

    const results = await screening.getResults(kitId);
    expect(results?.kitId).toBe(kitId);
    expect(results?.panel.map((m) => m.marker).sort()).toEqual([
      'cholesterol',
      'hba1c',
      'liver',
      'thyroid',
    ]);
  });
});

describe('screening orchestration: the branch walks and lands in the review queue', () => {
  it('order -> receive -> results -> route, advancing the journey and the pointer', { timeout: 60_000 }, async () => {
    const screening = getScreening(env, admin);
    const { accountId, corePatientId, intakeId } = await patientAtIntakeSubmitted();

    const kitRef = await orderScreeningKit(admin, screening, accountId, corePatientId);
    expect((await getJourney(admin, accountId))?.state).toBe('screening_kit_sent');
    expect((await getLatestScreeningRef(admin, accountId))?.status).toBe('kit_sent');

    await receiveScreeningSample(admin, accountId, kitRef);
    expect((await getJourney(admin, accountId))?.state).toBe('sample_received');

    await attachScreeningResults(admin, accountId, kitRef);
    expect((await getJourney(admin, accountId))?.state).toBe('results_ready');
    expect((await getLatestScreeningRef(admin, accountId))?.status).toBe('results_ready');

    const queueItemId = await routeScreenedToReview(admin, accountId, intakeId);
    expect(queueItemId).toBeTruthy();
    const journey = await getJourney(admin, accountId);
    expect(journey?.state).toBe('in_review_queue');
    expect(journey?.lane).toBe('fast');
  });
});

describe('THE GUARD: a prescribing decision is blocked until the bloods are in', () => {
  // A screening-required patient sitting in the review queue with bloods still
  // pending. (Defence in depth: the journey normally only reaches the queue after
  // results_ready, but the guard is the authoritative lock regardless of how the
  // patient got here.)
  async function screeningPatientInQueue(status: 'kit_sent' | 'results_ready') {
    const account = await ensureAccount(admin, crypto.randomUUID());
    createdAccounts.push(account.id);
    const corePatientId = await core.createPatient({ fullName: 'Guarded Patient' });
    await setCorePatientId(admin, account.id, corePatientId);
    await setJourney(admin, account.id, 'id_verified', null);
    await submitIntake(admin, core, account.id, corePatientId, 'weight', fastLaneAnswers());
    const kitRef = crypto.randomUUID();
    await recordScreeningRef(admin, account.id, kitRef, 'kit_sent');
    if (status === 'results_ready') await setScreeningRefStatus(admin, kitRef, 'results_ready');
    const { data } = await admin
      .from('queue_item')
      .select('*')
      .eq('account_id', account.id)
      .single();
    return { accountId: account.id, corePatientId, queueItemId: data!.id as string };
  }

  it('APPROVE is blocked while bloods are pending (kit_sent)', { timeout: 60_000 }, async () => {
    const clinicianId = await freshClinician();
    const { accountId, queueItemId } = await screeningPatientInQueue('kit_sent');
    await expect(
      decideClinicianAction(admin, core, {
        clinicianAccountId: clinicianId,
        queueItemId,
        action: 'approve',
        reason: 'looks fine',
        rxItems: [{ name: 'x' }],
      }),
    ).rejects.toThrow(ScreeningNotReadyError);
    // Nothing moved: still awaiting review, no script.
    expect((await getJourney(admin, accountId))?.state).toBe('in_review_queue');
  });

  it('REFUSE is NEVER gated by screening (a clinician can always decline)', { timeout: 60_000 }, async () => {
    const clinicianId = await freshClinician();
    const { accountId, queueItemId } = await screeningPatientInQueue('kit_sent');
    const result = await decideClinicianAction(admin, core, {
      clinicianAccountId: clinicianId,
      queueItemId,
      action: 'refuse',
      reason: 'not suitable; signpost to GP',
    });
    expect(result.newState).toBe('refused');
    expect((await getJourney(admin, accountId))?.state).toBe('refused');
  });

  it('APPROVE proceeds to rx_issued once the bloods are in (results_ready)', { timeout: 60_000 }, async () => {
    const clinicianId = await freshClinician();
    const { accountId, corePatientId, queueItemId } = await screeningPatientInQueue('results_ready');
    const result = await decideClinicianAction(admin, core, {
      clinicianAccountId: clinicianId,
      queueItemId,
      action: 'approve',
      reason: 'bloods in range; approve',
      rxItems: [{ name: 'Treatment', dose: 'as directed', quantity: 1 }],
    });
    expect(result.newState).toBe('rx_issued');
    expect((await getJourney(admin, accountId))?.state).toBe('rx_issued');
    // The script is clinician-issued from a decision state (rx_issued hard line).
    const scripts = await core.getPrescriptions(corePatientId);
    expect(scripts).toHaveLength(1);
    expect(scripts[0].request.decisionState).toBe('approved');
  });
});

describe('boundary: screening_ref holds no clinical content, only pointers + status', () => {
  const DENYLIST = /marker|value|range|panel|result|cholesterol|hba1c|liver|thyroid|reason|note|answer|diagnosis/i;

  it('screening_ref has exactly {id, account_id, kit_ref, status, created_at, updated_at}', { timeout: 60_000 }, async () => {
    const account = await ensureAccount(admin, crypto.randomUUID());
    createdAccounts.push(account.id);
    await recordScreeningRef(admin, account.id, crypto.randomUUID(), 'kit_sent');
    const { data, error } = await admin
      .from('screening_ref')
      .select('*')
      .eq('account_id', account.id)
      .single();
    expect(error).toBeFalsy();
    const cols = Object.keys(data!).sort();
    expect(cols).toEqual([
      'account_id',
      'created_at',
      'id',
      'kit_ref',
      'status',
      'updated_at',
    ]);
    for (const col of cols) {
      expect(col, `screening_ref.${col} looks like clinical detail`).not.toMatch(DENYLIST);
    }
  });
});
