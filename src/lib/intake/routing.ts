import type { Lane } from '../journey/states';

// ===========================================================================
// P2 routing engine. The deterministic, pure decision function that takes the
// intake answers and returns the NEXT STEP (a lane, or a stop + signpost). This
// is the single source of routing truth: the form, the submit orchestration and
// the tests all read it from here, nothing re-implements the rules.
//
// HARD LINE (describe-never-diagnose): this NEVER returns a diagnosis or a
// treatment recommendation. It returns where the patient goes next and a plain
// reason for it. Red-flag stops are clinically-set screening content and force a
// signpost, never a lane. HRT initiation leans the assessed (full) lane by rule.
// Nothing here can reach a prescribing state — that is a clinician action only.
// ===========================================================================

export type IntakeOutcome = 'fast' | 'full' | 'stop';

export interface Signpost {
  service: string;
  message: string;
}

export interface RoutingDecision {
  outcome: IntakeOutcome;
  // The routed lane, or null for a red-flag stop (no lane is assigned).
  lane: Lane | null;
  // Plain-language reasons for the routing decision. Phrased as next-step
  // routing, never as a diagnosis. These ride along into the CLINICAL CORE
  // record (Article 9), never the app DB.
  reasons: string[];
  // Present only for a stop.
  signpost: Signpost | null;
}

// The structured answers. Article 9 clinical content: lives ONLY in the core.
export interface IntakeAnswers {
  // The lane discriminator: continuing an existing HRT vs starting for the
  // first time (initiation). Initiation leans the assessed lane by rule.
  treatmentHistory: 'continuing' | 'initiation';
  // Selected symptom ids (see SYMPTOM_OPTIONS). An empty picture is incomplete.
  symptoms: string[];
  monthsSinceLastPeriod: number | null;
  // Self-reported blood pressure. Missing means an incomplete safety picture.
  bpSystolic: number | null;
  bpDiastolic: number | null;
  // Contraindication / risk screen (reviewer-set). Any true -> assessed lane.
  clotHistory: boolean;
  breastCancerHistory: boolean;
  liverDisease: boolean;
  // Red-flag screen (reviewer-set). Any true -> stop + signpost, no lane.
  unexplainedBleeding: boolean;
  currentPregnancy: boolean;
  suspectedClotSymptoms: boolean;
  undiagnosedBreastLump: boolean;
}

// Blood-pressure thresholds (self-report). A crisis reading is a red-flag stop;
// a raised reading routes to the assessed lane.
const BP_CRISIS_SYSTOLIC = 180;
const BP_CRISIS_DIASTOLIC = 120;
const BP_RAISED_SYSTOLIC = 140;
const BP_RAISED_DIASTOLIC = 90;

export function routeIntake(a: IntakeAnswers): RoutingDecision {
  // 1. Hard red-flag stops take precedence over EVERYTHING. A red flag always
  //    signposts and never assigns a lane, regardless of the rest of the form.
  const stopReasons: string[] = [];
  let acute = false;

  if (a.unexplainedBleeding) {
    stopReasons.push(
      'You reported unexplained vaginal bleeding, which a doctor needs to check before any HRT.',
    );
  }
  if (a.undiagnosedBreastLump) {
    stopReasons.push(
      'You reported a new breast lump that has not been checked, which a doctor needs to examine first.',
    );
  }
  if (a.currentPregnancy) {
    stopReasons.push('You indicated you may be pregnant, so HRT is not the right step now.');
  }
  if (a.suspectedClotSymptoms) {
    stopReasons.push(
      'You reported symptoms that can signal a blood clot, which need urgent assessment.',
    );
    acute = true;
  }
  const bpCrisis =
    (a.bpSystolic != null && a.bpSystolic >= BP_CRISIS_SYSTOLIC) ||
    (a.bpDiastolic != null && a.bpDiastolic >= BP_CRISIS_DIASTOLIC);
  if (bpCrisis) {
    stopReasons.push(
      'The blood pressure you reported is very high and needs to be checked urgently.',
    );
    acute = true;
  }

  if (stopReasons.length > 0) {
    return {
      outcome: 'stop',
      lane: null,
      reasons: stopReasons,
      signpost: acute
        ? {
            service: 'NHS 111 or 999',
            message:
              'Please contact NHS 111 now, or call 999 if symptoms are severe. This service cannot continue your request.',
          }
        : {
            service: 'your GP',
            message:
              'Please contact your GP so this can be checked. This service cannot continue your request until then.',
          },
    };
  }

  // 2. Otherwise, collect every reason that routes to the assessed (full) lane.
  //    Any single reason is enough; we list them all for an honest explanation.
  const fullReasons: string[] = [];

  if (a.treatmentHistory === 'initiation') {
    fullReasons.push('Starting HRT for the first time needs an assessed consultation.');
  }
  if (a.clotHistory) {
    fullReasons.push('A history of blood clots needs a clinician to review it before HRT.');
  }
  if (a.breastCancerHistory) {
    fullReasons.push('A history of breast cancer needs a clinician to review it before HRT.');
  }
  if (a.liverDisease) {
    fullReasons.push('A history of liver disease needs a clinician to review it before HRT.');
  }
  const bpRaised =
    (a.bpSystolic != null && a.bpSystolic >= BP_RAISED_SYSTOLIC) ||
    (a.bpDiastolic != null && a.bpDiastolic >= BP_RAISED_DIASTOLIC);
  if (bpRaised) {
    fullReasons.push('The blood pressure you reported is raised and should be reviewed in a consultation.');
  }
  // An incomplete safety picture also routes to the assessed lane.
  if (a.symptoms.length === 0) {
    fullReasons.push('We need a clearer picture of your symptoms, so a consultation is the safer next step.');
  }
  if (a.bpSystolic == null || a.bpDiastolic == null) {
    fullReasons.push('A recent blood pressure reading is needed, which a consultation will cover.');
  }

  if (fullReasons.length > 0) {
    return { outcome: 'full', lane: 'full', reasons: fullReasons, signpost: null };
  }

  // 3. A clear, ongoing picture with no flags -> the fast (async review) lane.
  return {
    outcome: 'fast',
    lane: 'fast',
    reasons: [
      'This looks like a continuation of treatment with no new risk flags, so it can go to our clinician review queue.',
    ],
    signpost: null,
  };
}
