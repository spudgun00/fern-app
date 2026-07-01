import type { ScreeningRef } from '../accounts';

// ===========================================================================
// THE SCREENING GUARD (weight roadmap P2). Screening before prescribing:
//
//   For a screening-REQUIRED patient (one for whom an at-home blood test was
//   ordered), a clinician's PRESCRIBING decision — fast-lane approve, or
//   full-lane issue at the consult, both of which advance towards rx_issued — is
//   BLOCKED until the bloods are in (screening_ref.status === 'results_ready').
//
// This is a SECOND, INDEPENDENT lock, distinct from the rx_issued hard line:
//   * The journey machine's RX_ISSUED_PREDECESSORS lock guarantees rx_issued is
//     only ever reached from a clinician-decision state (approved / consult_done).
//     It is UNCHANGED by this phase.
//   * This guard guarantees that, WHEN screening was required, the clinician may
//     not even take that decision until the blood test has reported. The bloods
//     are a mandatory precondition of the decision — an INPUT to it, never a
//     decision-maker: this guard blocks, it never approves or issues anything.
//
// A clinician can ALWAYS refuse or escalate (decline / route on) regardless of
// bloods — those are not prescribing decisions, so the guard does not gate them.
//
// If no screening was required (no screening_ref — e.g. the menopause fast lane),
// the guard is a no-op, so existing non-screening flows are untouched.
// ===========================================================================

export class ScreeningNotReadyError extends Error {
  constructor(message = 'screening: bloods not yet in — a prescribing decision is blocked until results_ready') {
    super(message);
    this.name = 'ScreeningNotReadyError';
  }
}

// True once the patient's ordered screening has reported (results_ready).
export function screeningResultsReady(ref: ScreeningRef | null): boolean {
  return ref?.status === 'results_ready';
}

// True when a screening was ordered for this patient (a screening_ref exists) but
// has not yet reported — i.e. a prescribing decision must wait.
export function screeningPending(ref: ScreeningRef | null): boolean {
  return ref != null && ref.status !== 'results_ready';
}

// Throws unless it is legal to take a PRESCRIBING decision now. The rule:
//   * no screening_ref               -> not a screening patient -> allowed (no-op)
//   * screening_ref, results_ready   -> bloods are in -> allowed
//   * screening_ref, anything else   -> bloods pending -> BLOCKED (throws)
// Call this in the approve / issue branch of a clinician decision, BEFORE any
// transition towards rx_issued.
export function assertScreeningReadyForDecision(ref: ScreeningRef | null): void {
  if (screeningPending(ref)) {
    throw new ScreeningNotReadyError();
  }
}
