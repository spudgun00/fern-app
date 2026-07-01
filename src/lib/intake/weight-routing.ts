import { assessWeightEligibility, type WeightEligibility } from './weight';

// ===========================================================================
// GLP intake lane — the contraindication screen (weight roadmap P4). The pure,
// deterministic front door for the weight lane, the parallel of routeIntake for
// menopause. Screens for the absolute contraindications the public "not suitable
// if" copy lists; a hit STOPS the journey with a GP signpost. Otherwise the
// patient PROCEEDS into the screening branch (bloods first), and a clinician
// still decides after the bloods are in (the guard + rx_issued hard line apply).
//
// BMI is guidance, not a gate: an out-of-range BMI does NOT stop the journey (a
// clinician makes that call after screening); it is surfaced to the console via
// assessWeightEligibility. Absolute contraindications DO stop it.
//
// This function is pure and fully unit-tested. The ANSWERS (incl. BMI) are
// Article 9 and are written to the core by submitWeightIntake, never the app DB.
// ===========================================================================

export interface WeightIntakeAnswers {
  bmi: number;
  hasRelatedCondition?: boolean;
  currentPregnancy: boolean;
  planningPregnancy: boolean;
  breastfeeding: boolean;
  eatingDisorderHistory: boolean;
  // Personal/family history of medullary thyroid carcinoma or MEN2 — a labelled
  // contraindication for GLP-1 receptor agonists.
  thyroidCancerHistory: boolean;
  pancreatitisHistory: boolean;
}

export type WeightOutcome = 'proceed' | 'stop';

export interface WeightRoutingDecision {
  outcome: WeightOutcome;
  reasons: string[];
  signpost?: string;
  eligibility: WeightEligibility;
}

// The absolute contraindications, in check order. Each is [answer flag, the
// clinician-facing reason]. A single hit -> stop.
const CONTRAINDICATIONS: Array<[keyof WeightIntakeAnswers, string]> = [
  ['currentPregnancy', 'Currently pregnant'],
  ['planningPregnancy', 'Planning pregnancy'],
  ['breastfeeding', 'Breastfeeding'],
  ['eatingDisorderHistory', 'History of an eating disorder'],
  ['thyroidCancerHistory', 'Personal or family history of medullary thyroid cancer / MEN2'],
  ['pancreatitisHistory', 'History of pancreatitis'],
];

const GP_SIGNPOST =
  'Based on your answers this treatment is not suitable right now. Please speak to your GP about your options.';

export function routeWeightIntake(answers: WeightIntakeAnswers): WeightRoutingDecision {
  const eligibility = assessWeightEligibility({
    bmi: answers.bmi,
    hasRelatedCondition: answers.hasRelatedCondition,
  });

  const reasons = CONTRAINDICATIONS.filter(([flag]) => Boolean(answers[flag])).map(
    ([, reason]) => reason,
  );

  if (reasons.length > 0) {
    return { outcome: 'stop', reasons, signpost: GP_SIGNPOST, eligibility };
  }

  return { outcome: 'proceed', reasons: [], eligibility };
}
