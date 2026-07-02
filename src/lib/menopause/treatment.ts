import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClinicalCoreAdapter } from '../adapters/clinical-core';
import type { CtaFlags } from '../cta';
import type { JourneyState } from '../journey/states';
import { getJourney } from '../accounts';
import { getMenopauseProduct } from './catalogue';
import {
  routeMenopauseTreatment,
  type MenopauseTreatmentAnswers,
  type MenopauseTreatmentDecision,
} from './treatment-intake';

// ===========================================================================
// Checkout C6 — the menopause treatment step orchestration + the surface-state
// helper. This is where the patient's HRT PREFERENCE is recorded, and the single
// place the /treatment/choose surface decides what to render.
//
// HARD LINE (unmissable): submitMenopauseTreatment NEVER calls the journey
// machine. It writes the answers + validated selection to the clinical core and
// returns; the journey state is UNCHANGED by choosing a treatment. A clinician
// still issues every script (rx_issued stays reachable only from approved /
// consult_done). Choosing a treatment is a preference, not a prescription.
// ===========================================================================

// The exact C2 placeholder wording, kept here as the single source so the
// checkout descriptor note and the treatment-step surface agree. Never a drug
// name; shown whenever menopauseRx is off.
export const TREATMENT_STEP_PLACEHOLDER =
  'Treatment step — pending menopause catalogue (phase C6). No treatment is chosen or charged here.';

// The states from which the real treatment step is offered: after a clinician
// has reviewed the screen and approved / issued (or the patient is a member).
// Before that the surface shows a plain "not yet" note. This is a display gate,
// NOT a state-machine transition — the surface never advances the journey.
const TREATMENT_STEP_STATES: readonly JourneyState[] = [
  'approved',
  'rx_issued',
  'dispensing',
  'delivered',
  'active_member',
  'consult_done',
];

export function isTreatmentStepEligible(state: JourneyState | null | undefined): boolean {
  return state != null && TREATMENT_STEP_STATES.includes(state);
}

export type TreatmentStepMode = 'placeholder' | 'not-eligible' | 'catalogue';

// What the /treatment/choose surface should render:
//   * 'placeholder'  — menopauseRx OFF: the labelled C6 placeholder (default).
//   * 'not-eligible' — flag on, but the clinician has not reviewed the screen yet.
//   * 'catalogue'    — flag on + eligible: the real catalogue + contraindication step.
export function treatmentStepMode(
  flags: Pick<CtaFlags, 'menopauseRx'>,
  state: JourneyState | null | undefined,
): TreatmentStepMode {
  if (!flags.menopauseRx) return 'placeholder';
  return isTreatmentStepEligible(state) ? 'catalogue' : 'not-eligible';
}

export interface MenopauseTreatmentSubmitResult {
  intakeId: string | null;
  decision: MenopauseTreatmentDecision;
  // The journey state BEFORE and AFTER the submit — identical by construction
  // (this call never transitions the journey). Returned so callers/tests can
  // assert the hard line directly.
  stateBefore: JourneyState | null;
  stateAfter: JourneyState | null;
}

// Record the patient's treatment preference. Runs the contraindication screen,
// writes the ANSWERS + validated selection to the CORE (Article 9), and returns.
// It does NOT advance the journey (proven by stateBefore === stateAfter). A
// contraindication STOP records nothing selectable and signposts; a proceed
// records the preference for the clinician to action.
export async function submitMenopauseTreatment(
  admin: SupabaseClient,
  core: ClinicalCoreAdapter,
  flags: Pick<CtaFlags, 'menopauseRx'>,
  accountId: string,
  corePatientId: string,
  answers: MenopauseTreatmentAnswers,
): Promise<MenopauseTreatmentSubmitResult> {
  const before = await getJourney(admin, accountId);
  const stateBefore = before?.state ?? null;

  const decision = routeMenopauseTreatment(answers);

  // Defence in depth: a selection is only honoured when it resolves under the
  // flag too (the pure screen already validated the id structurally). With the
  // flag off nothing selectable is recorded — the surface never reaches here.
  const resolvedSelection = decision.selectedProductId
    ? getMenopauseProduct(decision.selectedProductId, flags)
    : null;

  // Write the preference to the clinical core. condition 'menopause_treatment'
  // distinguishes it from the initial 'menopause' intake; lane null (this is not
  // a routing decision, it is a recorded preference). The clinical answers +
  // selection live behind the adapter, never the app DB.
  const intakeId = await core.saveIntake(corePatientId, {
    condition: 'menopause_treatment',
    lane: null,
    answers: answers as unknown as Record<string, unknown>,
    treatmentSelection: resolvedSelection?.id ?? null,
    // The clinician-facing name of the selection rides in the clinical record so
    // the console can show it; it is NOT a prescription.
    treatmentSelectionClinicianName: resolvedSelection?.clinicianName ?? null,
    contraindicationOutcome: decision.outcome,
  });

  // Deliberately NO advanceJourney call. Re-read to prove the state is unchanged.
  const after = await getJourney(admin, accountId);

  return {
    intakeId,
    decision: { ...decision, selectedProductId: resolvedSelection?.id ?? null },
    stateBefore,
    stateAfter: after?.state ?? null,
  };
}
