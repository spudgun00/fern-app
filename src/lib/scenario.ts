import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppEnv } from './env';
import { getClinicalCore } from './adapters/factory';
import {
  ensureAccount,
  getJourney,
  setCorePatientId,
  setJourney,
} from './accounts';
import { transition } from './journey/machine';
import type { JourneyState } from './journey/states';

export interface TraceStep {
  step: string;
  detail: string;
}

export interface ScenarioResult {
  accountId: string;
  corePatientId: string;
  intakeId: string;
  journeyState: JourneyState;
  lane: string | null;
  intakeReadBack: unknown;
  trace: TraceStep[];
}

// The visible proof: runs end to end through the adapters and the state machine.
// Re-running RESETS cleanly (idempotent reset): the journey returns to
// 'registered', the account's core_patient_id is cleared, and the account's
// queue_item pointers are deleted, then a fresh run executes. Older mock_*
// rows from previous runs are left in place (they are inert, namespaced dev
// data) and a new mock patient/intake is created each run.
export async function runHarnessScenario(
  env: AppEnv,
  admin: SupabaseClient,
  authUserId: string,
  profile: { email?: string; fullName?: string } = {},
): Promise<ScenarioResult> {
  const trace: TraceStep[] = [];
  const push = (step: string, detail: string) => trace.push({ step, detail });

  const account = await ensureAccount(admin, authUserId);
  push('account', `account ${account.id} (role ${account.role})`);

  // Idempotent reset.
  await admin.from('queue_item').delete().eq('account_id', account.id);
  await setCorePatientId(admin, account.id, null);
  await setJourney(admin, account.id, 'registered', null);
  push('reset', 'journey reset to registered; queue_item pointers cleared; core_patient_id cleared');

  const core = getClinicalCore(env, admin);
  push('factory', `clinical core impl selected via CORE_IMPL=${env.CORE_IMPL}`);

  // 1. Create a mock core patient, map core_patient_id onto the logged-in account.
  const corePatientId = await core.createPatient({
    fullName: profile.fullName ?? 'Dev Harness Patient',
    email: profile.email,
  });
  await setCorePatientId(admin, account.id, corePatientId);
  push('createPatient', `core_patient_id ${corePatientId} created and mapped onto the account`);

  // 2. Advance the journey through the legal chain to intake_submitted.
  //    (The canonical machine routes via id_pending/id_verified; ID is a P1
  //    surface, so these are state transitions only, no real verification yet.)
  let state: JourneyState = 'registered';
  const path: JourneyState[] = ['id_pending', 'id_verified', 'intake_started', 'intake_submitted'];
  for (const next of path) {
    state = transition(state, next);
    await setJourney(admin, account.id, state, null);
    push('transition', `${state}`);
  }

  // 3. Save a mock intake via the adapter, create a queue_item POINTER, and
  //    advance to in_review_queue on the fast lane.
  const intakeId = await core.saveIntake(corePatientId, {
    condition: 'menopause',
    lane: 'fast',
    answers: { repeat: true, redFlags: false },
  });
  push('saveIntake', `intake ${intakeId} written to the core via saveIntake`);

  const { error: qErr } = await admin.from('queue_item').insert({
    account_id: account.id,
    intake_id: intakeId,
    lane: 'fast',
    status: 'pending',
  });
  if (qErr) throw new Error(`queue_item insert: ${qErr.message}`);
  push('queue_item', `pointer created (intake_id ${intakeId}, lane fast) — pointer only, no clinical content`);

  state = transition(state, 'in_review_queue');
  await setJourney(admin, account.id, state, 'fast');
  push('transition', `${state} (lane fast)`);

  // 4. Read the intake back via the adapter.
  const readBack = await core.getIntake(intakeId);
  push(
    'getIntake',
    `read back intake ${readBack?.id}: condition=${readBack?.payload.condition}, lane=${readBack?.payload.lane}`,
  );

  const journey = await getJourney(admin, account.id);

  return {
    accountId: account.id,
    corePatientId,
    intakeId,
    journeyState: (journey?.state ?? state) as JourneyState,
    lane: journey?.lane ?? null,
    intakeReadBack: readBack,
    trace,
  };
}
