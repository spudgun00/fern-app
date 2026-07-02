import { isKnownProductId } from './catalogue';

// ===========================================================================
// Checkout C6 — the menopause treatment intake. The pure, deterministic
// contraindication + selection screen for HRT, the parallel of routeWeightIntake
// (the GLP contraindication screen). It runs AFTER the screen has been reviewed
// and approved, BEFORE a product is chosen: it screens for the NICE NG23 / BMS
// contraindications to systemic HRT, and validates the patient's product choice.
//
// HARD LINE: nothing here prescribes or advances the journey. A contraindication
// STOPS with a clinician/GP signpost (no selection is accepted). Otherwise the
// outcome is 'proceed' and the validated selection is a PREFERENCE that rides to
// the clinician — a clinician still writes every script (rx_issued stays a
// clinician action from approved / consult_done). No questionnaire-only auto-issue.
//
// This function is pure and fully unit-tested. The ANSWERS + the selection are
// Article 9 and are written to the clinical core by submitMenopauseTreatment,
// never the app DB.
// ===========================================================================

export interface MenopauseTreatmentAnswers {
  // Absolute / strong contraindications to SYSTEMIC HRT (NICE NG23 / BMS). Any
  // true -> stop + signpost. Reviewer-set flags, the same discipline as the
  // menopause intake red-flag screen.
  currentOrPastBreastCancer: boolean;
  oestrogenDependentCancer: boolean;
  activeVte: boolean; // active or recent venous thromboembolism (DVT / PE)
  activeArterialDisease: boolean; // recent angina / heart attack / stroke
  activeLiverDisease: boolean; // active liver disease with abnormal liver function
  undiagnosedVaginalBleeding: boolean;
  pregnancy: boolean;
  // Does the patient have a uterus? Guidance for the clinician (a woman with a
  // uterus needs endometrial protection alongside systemic oestrogen). It does
  // NOT stop the journey and does not by itself invalidate a selection — the
  // clinician sets the regimen. Optional; defaults to unknown (treated as true,
  // the safer assumption for the note).
  hasUterus?: boolean;
  // The patient's chosen catalogue product id, if they have chosen one. Optional:
  // the screen can be run for the contraindication check alone, then again with a
  // selection once the patient has picked.
  selectedProductId?: string;
}

export type MenopauseTreatmentOutcome = 'proceed' | 'stop';

export interface MenopauseTreatmentDecision {
  outcome: MenopauseTreatmentOutcome;
  // Clinician-facing reasons for a stop (empty on proceed).
  reasons: string[];
  // Patient-facing signpost, present only on a stop.
  signpost?: string;
  // The validated selection (a known catalogue product id), or null when the
  // patient has not chosen yet or the id was not recognised. Never a prescription.
  selectedProductId: string | null;
  // A clinician-facing note when a woman with a uterus proceeds: systemic
  // oestrogen needs endometrial protection. Guidance only; the clinician decides.
  needsProgestogenNote: boolean;
}

// The absolute / strong contraindications, in check order. Each is [answer flag,
// the clinician-facing reason]. A single hit -> stop.
const CONTRAINDICATIONS: Array<[keyof MenopauseTreatmentAnswers, string]> = [
  ['currentOrPastBreastCancer', 'Current or past breast cancer'],
  ['oestrogenDependentCancer', 'Known or suspected oestrogen-dependent cancer'],
  ['activeVte', 'Active or recent venous thromboembolism (DVT / PE)'],
  ['activeArterialDisease', 'Active or recent arterial thromboembolic disease (angina / MI / stroke)'],
  ['activeLiverDisease', 'Active liver disease with abnormal liver function'],
  ['undiagnosedVaginalBleeding', 'Undiagnosed vaginal bleeding'],
  ['pregnancy', 'Known or suspected pregnancy'],
];

const GP_SIGNPOST =
  'Based on your answers, this treatment is not something we can start for you online. Please speak to your GP or a menopause specialist about your options.';

export function routeMenopauseTreatment(
  answers: MenopauseTreatmentAnswers,
): MenopauseTreatmentDecision {
  const reasons = CONTRAINDICATIONS.filter(([flag]) => Boolean(answers[flag])).map(
    ([, reason]) => reason,
  );

  // Only accept a selection that is a real catalogue product id (structural
  // check; the flag gate is applied at the surface / API via getMenopauseProduct).
  const selectedProductId =
    answers.selectedProductId && isKnownProductId(answers.selectedProductId)
      ? answers.selectedProductId
      : null;

  if (reasons.length > 0) {
    return {
      outcome: 'stop',
      reasons,
      signpost: GP_SIGNPOST,
      // A contraindication is not the moment to hold a selection.
      selectedProductId: null,
      needsProgestogenNote: false,
    };
  }

  // A woman with a uterus (or where it is unknown) proceeding on systemic
  // oestrogen needs endometrial protection — a note for the clinician, not a stop.
  const hasUterus = answers.hasUterus ?? true;

  return {
    outcome: 'proceed',
    reasons: [],
    selectedProductId,
    needsProgestogenNote: hasUterus,
  };
}
