import { type JourneyState } from './states';

// Allowed transitions. This map is the single source of truth for journey
// legality. Any transition not listed here is illegal and throws.
//
// HARD LINE (pre-baked now): the ONLY transitions into `rx_issued` are from
// `approved` or `consult_done` (the clinician-decision states). No other state
// lists `rx_issued` as a target, so no direct or skipped jump can reach it. The
// clinician console that produces `approved` / `consult_done` arrives in P3/P6;
// the guard exists now.
export const ALLOWED_TRANSITIONS: Record<JourneyState, readonly JourneyState[]> = {
  registered: ['id_pending'],
  id_pending: ['id_verified'],
  id_verified: ['intake_started'],
  intake_started: ['intake_submitted'],
  // Routing fork: fast lane -> queue; full lane -> consult.
  intake_submitted: ['in_review_queue', 'consult_booked'],
  in_review_queue: ['approved', 'escalated', 'refused'],
  approved: ['rx_issued'], // clinician decision -> script (one of two allowed entries to rx_issued)
  escalated: ['consult_booked'], // re-route a fast-lane patient into the full lane
  refused: [], // terminal
  consult_booked: ['consult_done'],
  consult_done: ['rx_issued'], // clinician decision -> script (the other allowed entry to rx_issued)
  rx_issued: ['dispensing'],
  dispensing: ['delivered'],
  delivered: ['active_member'],
  active_member: [], // terminal for P0
};

// The two and only states from which `rx_issued` may be entered. Kept as an
// explicit constant so the hard line is independently assertable in tests.
export const RX_ISSUED_PREDECESSORS: readonly JourneyState[] = ['approved', 'consult_done'];

export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: JourneyState,
    public readonly to: JourneyState,
  ) {
    super(`Illegal journey transition: ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export function canTransition(from: JourneyState, to: JourneyState): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

// Returns the new state on success; throws IllegalTransitionError otherwise.
export function transition(from: JourneyState, to: JourneyState): JourneyState {
  if (!canTransition(from, to)) {
    throw new IllegalTransitionError(from, to);
  }
  return to;
}
