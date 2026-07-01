import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClinicalCoreAdapter } from '../adapters/clinical-core';
import type { ScreeningAdapter } from '../adapters/screening';
import { advanceJourney, recordIntakeRef } from '../accounts';
import {
  routeWeightIntake,
  type WeightIntakeAnswers,
  type WeightRoutingDecision,
} from '../intake/weight-routing';
import { orderScreeningKit } from '../screening/order';

export interface WeightSubmitResult {
  intakeId: string;
  decision: WeightRoutingDecision;
  kitRef: string | null;
}

// The single place a weight (GLP) intake is submitted. Runs the contraindication
// screen, writes the ANSWERS (incl. BMI — Article 9) to the CORE, advances the
// journey, and records the app-DB pointer + outcome. Precondition: the journey is
// at id_verified (the ID gate), same as the menopause submitIntake.
//
// HARD LINE: nothing here prescribes. A contraindication STOPS the journey at
// intake_submitted with a GP signpost (no lane, no kit). Otherwise the patient
// PROCEEDS into the screening branch (intake_submitted -> screening_kit_sent);
// the bloods must come in before a clinician can decide (the screening guard),
// and a clinician still makes the decision. No questionnaire-only auto-issue.
export async function submitWeightIntake(
  admin: SupabaseClient,
  core: ClinicalCoreAdapter,
  screening: ScreeningAdapter,
  accountId: string,
  corePatientId: string,
  answers: WeightIntakeAnswers,
): Promise<WeightSubmitResult> {
  const decision = routeWeightIntake(answers);

  // Answers (BMI + contraindications) -> the core. The routing decision rides in
  // the clinical record; the app DB gets a pointer + outcome only.
  const intakeId = await core.saveIntake(corePatientId, {
    condition: 'weight',
    lane: 'fast',
    answers: answers as unknown as Record<string, unknown>,
    routing: decision,
  });

  await advanceJourney(admin, accountId, 'intake_started');
  await advanceJourney(admin, accountId, 'intake_submitted');
  await recordIntakeRef(admin, accountId, intakeId, decision.outcome === 'stop' ? 'stop' : 'fast', 'submitted');

  if (decision.outcome === 'stop') {
    // Contraindication: the journey stays at intake_submitted with the signpost.
    return { intakeId, decision, kitRef: null };
  }

  // Proceed: order the at-home blood test (intake_submitted -> screening_kit_sent).
  const kitRef = await orderScreeningKit(admin, screening, accountId, corePatientId);
  return { intakeId, decision, kitRef };
}
