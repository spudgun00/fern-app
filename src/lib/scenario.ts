import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppEnv } from './env';
import { getClinicalCore, getIdentity } from './adapters/factory';
import { MockIdentity } from './adapters/mock-identity';
import {
  ensureAccount,
  getJourney,
  recordGpSharing,
  recordIdVerification,
  setCorePatientId,
  setJourney,
} from './accounts';
import { finaliseVerification } from './verification';
import { transition } from './journey/machine';
import type { JourneyState } from './journey/states';

export interface TraceStep {
  step: string;
  detail: string;
}

export interface ScenarioResult {
  accountId: string;
  corePatientId: string;
  intakeId: string | null;
  journeyState: JourneyState;
  lane: string | null;
  intakeReadBack: unknown;
  trace: TraceStep[];
}

// The visible proof: runs end to end through the adapters and the state machine,
// including the P1 identity-verification round-trip through the IdentityAdapter.
// Re-running RESETS cleanly (idempotent reset): the journey returns to
// 'registered', the account's core_patient_id is cleared, and the account's
// queue_item / id_verification / gp_sharing / mock_identity rows are deleted,
// then a fresh run executes. Older mock_* core rows from previous runs are left
// in place (inert, namespaced dev data) and a new mock patient/intake is created.
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
  await admin.from('id_verification').delete().eq('account_id', account.id);
  await admin.from('gp_sharing').delete().eq('account_id', account.id);
  await admin.from('mock_identity_verification').delete().eq('account_id', account.id);
  await setCorePatientId(admin, account.id, null);
  await setJourney(admin, account.id, 'registered', null);
  push('reset', 'journey reset to registered; queue_item / id_verification / gp_sharing / mock_identity cleared; core_patient_id cleared');

  const core = getClinicalCore(env, admin);
  push('factory', `clinical core impl selected via CORE_IMPL=${env.CORE_IMPL}`);

  // 1. Create a mock core patient, map core_patient_id onto the logged-in account.
  const corePatientId = await core.createPatient({
    fullName: profile.fullName ?? 'Dev Harness Patient',
    email: profile.email,
  });
  await setCorePatientId(admin, account.id, corePatientId);
  push('createPatient', `core_patient_id ${corePatientId} created and mapped onto the account`);

  // 2. Record a GP info-sharing decision (consent path here). The refusal path
  //    is exercised by the test suite (it requires a recorded risk note).
  await recordGpSharing(admin, account.id, 'consent', null);
  push('recordGpSharing', 'GP info-sharing decision recorded: consent');

  // 3. ID verification through the IdentityAdapter (a real adapter round-trip,
  //    not a bare transition). registered -> id_pending, create a session,
  //    record the pointer (provider_ref + status only), get status, finalise.
  const identity = getIdentity(env, admin);
  push('identity-factory', `identity impl selected via IDENTITY_IMPL=${env.IDENTITY_IMPL}`);

  let state: JourneyState = transition('registered', 'id_pending');
  await setJourney(admin, account.id, state, null);
  push('transition', `${state}`);

  const session = await identity.createVerificationSession(account.id, '/account/verify/complete');
  await recordIdVerification(admin, account.id, session.sessionId, 'requires_input');
  push('createVerificationSession', `session ${session.sessionId}; pointer recorded (provider_ref + status only, no PII)`);

  // The mock provider can be completed server-side here; the real Stripe flow is
  // completed by the user in test mode (success test C), so only auto-complete
  // the mock.
  if (identity instanceof MockIdentity) {
    await identity.markVerified(session.sessionId);
    push('mock-complete', 'mock provider marked the session verified (stands in for the hosted flow)');
  }

  const liveStatus = await identity.getVerificationStatus(session.sessionId);
  const finalStatus = await finaliseVerification(admin, account.id, session.sessionId, liveStatus);
  push('getVerificationStatus', `provider status ${finalStatus}; journey advanced if verified`);

  let journey = await getJourney(admin, account.id);
  state = (journey?.state ?? state) as JourneyState;
  push('transition', `${state}`);

  // If the provider did not verify (e.g. IDENTITY_IMPL=stripe, which must be
  // completed in the browser), stop here honestly rather than faking the rest.
  if (state !== 'id_verified') {
    return {
      accountId: account.id,
      corePatientId,
      intakeId: null,
      journeyState: state,
      lane: journey?.lane ?? null,
      intakeReadBack: null,
      trace,
    };
  }

  // 4. Advance through intake to the review queue (proves the rest of the spine).
  for (const next of ['intake_started', 'intake_submitted'] as JourneyState[]) {
    state = transition(state, next);
    await setJourney(admin, account.id, state, null);
    push('transition', `${state}`);
  }

  // 5. Save a mock intake via the adapter, create a queue_item POINTER, advance
  //    to in_review_queue on the fast lane.
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

  // 6. Read the intake back via the adapter.
  const readBack = await core.getIntake(intakeId);
  push(
    'getIntake',
    `read back intake ${readBack?.id}: condition=${readBack?.payload.condition}, lane=${readBack?.payload.lane}`,
  );

  journey = await getJourney(admin, account.id);

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
