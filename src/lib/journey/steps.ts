// Phase E (legibility) — the patient-facing journey steps.
//
// A visible "Step N of M: <label>" indicator runs across every journey screen so
// a visitor always knows where they are and what is next. This file is the single
// source of the step labels + the state->step mapping (a pure resolver, unit-tested
// like cta.ts / start.ts). Presentation only: it drives no transition and gates
// nothing. The journey STATE machine (states.ts / machine.ts) is untouched — these
// six steps are a coarse, human-readable grouping of the fine-grained states, for
// display, not a second state machine.

import type { JourneyState } from './states.ts';

export interface JourneyStep {
  /** 1-based step number. */
  n: number;
  /** The short, patient-facing label. */
  label: string;
}

// The six steps of the patient walk. Order is the forward journey; TOTAL is derived.
export const JOURNEY_STEPS: readonly JourneyStep[] = [
  { n: 1, label: 'Create your account' },
  { n: 2, label: 'Verify your identity' },
  { n: 3, label: 'Your health questions' },
  { n: 4, label: 'Your health screen' },
  { n: 5, label: 'Clinician review' },
  { n: 6, label: 'Treatment and delivery' },
] as const;

export const JOURNEY_STEP_TOTAL = JOURNEY_STEPS.length;

/** The step for a given step number (1-based); clamps out-of-range. */
export function stepByNumber(n: number): JourneyStep {
  const i = Math.min(Math.max(n, 1), JOURNEY_STEP_TOTAL);
  return JOURNEY_STEPS[i - 1];
}

// Map a fine-grained journey state to its coarse display step. The six steps group
// the states: account -> ID -> intake -> screen/pay -> clinician review -> treatment.
// Screening + payment sit under "Your health screen"; the review queue / consult /
// approval sit under "Clinician review"; issuing / dispensing / delivered / member
// sit under "Treatment and delivery".
export function stepForState(state: JourneyState): number {
  switch (state) {
    case 'registered':
      return 1;
    case 'id_pending':
      return 2;
    case 'id_verified':
      return 3;
    case 'intake_started':
      return 3;
    case 'intake_submitted':
      return 4;
    case 'screening_kit_sent':
    case 'sample_received':
    case 'results_ready':
      return 4;
    case 'in_review_queue':
    case 'consult_booked':
    case 'consult_done':
    case 'approved':
    case 'escalated':
      return 5;
    case 'rx_issued':
    case 'dispensing':
    case 'delivered':
    case 'active_member':
    case 'refused':
      return 6;
    default:
      return 1;
  }
}
