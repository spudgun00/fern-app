import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClinicalCoreAdapter } from '../adapters/clinical-core';
import { advanceJourney, recordIntakeRef, setJourney } from '../accounts';
import { routeIntake, type IntakeAnswers, type RoutingDecision } from './routing';

export interface SubmitResult {
  intakeId: string;
  decision: RoutingDecision;
}

// The single place an intake is submitted. Computes the deterministic routing
// decision, writes the structured answers to the CORE (Article 9 lives only
// behind the adapter), advances the journey through the legal transitions, and
// records the app-DB pointer + outcome. Precondition: the journey is at
// id_verified (the ID gate). The route guards this before calling.
//
// HARD LINE: nothing here reaches a prescribing state. The furthest the fast
// lane goes is in_review_queue (a clinician picks it up in P3); the full lane
// stops at intake_submitted awaiting booking (P6); a red-flag stop assigns no
// lane at all. No questionnaire-only path can auto-issue a script.
export async function submitIntake(
  admin: SupabaseClient,
  core: ClinicalCoreAdapter,
  accountId: string,
  corePatientId: string,
  condition: string,
  answers: IntakeAnswers,
): Promise<SubmitResult> {
  const decision = routeIntake(answers);

  // Answers -> the core. The routing decision (outcome + reasons) rides along in
  // the clinical record, never the app DB.
  const intakeId = await core.saveIntake(corePatientId, {
    condition,
    lane: decision.lane,
    answers: answers as unknown as Record<string, unknown>,
    routing: decision,
  });

  // An intake was submitted: id_verified -> intake_started -> intake_submitted,
  // always, for all three outcomes.
  await advanceJourney(admin, accountId, 'intake_started');
  await advanceJourney(admin, accountId, 'intake_submitted');

  // App DB: pointer + outcome only.
  await recordIntakeRef(admin, accountId, intakeId, decision.outcome, 'submitted');

  if (decision.outcome === 'fast') {
    // Fast lane -> the clinician review queue. queue_item is a POINTER only.
    await advanceJourney(admin, accountId, 'in_review_queue', 'fast');
    const { error } = await admin.from('queue_item').insert({
      account_id: accountId,
      intake_id: intakeId,
      lane: 'fast',
      status: 'pending',
    });
    if (error) throw new Error(`submitIntake(queue_item): ${error.message}`);
  } else if (decision.outcome === 'full') {
    // Assessed lane: routed and awaiting a booking (P6). The lane is recorded;
    // the state stays at intake_submitted until intake_submitted -> consult_booked
    // happens when a slot is booked. No queue_item (it is not an async review).
    await setJourney(admin, accountId, 'intake_submitted', 'full');
  }
  // stop: no lane, no queue. The journey stays at intake_submitted and the
  // signpost is shown to the patient.

  return { intakeId, decision };
}
