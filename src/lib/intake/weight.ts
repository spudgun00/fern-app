// ===========================================================================
// Weight / BMI verification sub-step (weight roadmap P3). A deterministic, pure
// eligibility check, the parallel of routeIntake for the weight lane. BMI is
// Article 9 (special-category health data): the VALUE lives in the core intake
// answers behind the ClinicalCoreAdapter, never in the app DB. This function
// classifies it for the clinician's console; a clinician still makes the final
// decision (the guard + the rx_issued hard line both still apply).
//
// Threshold mirrors the public copy: BMI 30 or above, OR 27+ with a related
// health condition. This is guidance for the clinician, not an auto-decision.
// ===========================================================================

export interface WeightCheckInput {
  bmi: number;
  hasRelatedCondition?: boolean;
}

export interface WeightEligibility {
  eligible: boolean;
  reason: string;
}

export function assessWeightEligibility(input: WeightCheckInput): WeightEligibility {
  const bmi = Number(input.bmi);
  const hasRelatedCondition = input.hasRelatedCondition ?? false;
  if (!Number.isFinite(bmi) || bmi <= 0) {
    return { eligible: false, reason: 'No valid BMI recorded' };
  }
  if (bmi >= 30) {
    return { eligible: true, reason: 'BMI 30 or above' };
  }
  if (bmi >= 27 && hasRelatedCondition) {
    return { eligible: true, reason: 'BMI 27 or above with a related health condition' };
  }
  return {
    eligible: false,
    reason: 'BMI below the threshold for medical weight treatment',
  };
}

// Convenience for the console: pull the coarse weight inputs out of an intake
// payload's answers (if present) and classify. Returns null when the intake
// carries no BMI (e.g. a menopause intake), so the console shows nothing.
export function weightCheckFromAnswers(
  answers: Record<string, unknown> | null | undefined,
): { bmi: number; hasRelatedCondition: boolean; eligibility: WeightEligibility } | null {
  if (!answers) return null;
  const raw = answers.bmi;
  if (raw == null || raw === '') return null;
  const bmi = Number(raw);
  if (!Number.isFinite(bmi)) return null;
  const hasRelatedCondition = Boolean(answers.hasRelatedCondition);
  return { bmi, hasRelatedCondition, eligibility: assessWeightEligibility({ bmi, hasRelatedCondition }) };
}
