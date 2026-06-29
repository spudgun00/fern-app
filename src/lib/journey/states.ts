// The journey state machine vocabulary (app DB, the through-line).
// Order matches the spec exactly.
export const JOURNEY_STATES = [
  'registered',
  'id_pending',
  'id_verified',
  'intake_started',
  'intake_submitted',
  'in_review_queue',
  'approved',
  'escalated',
  'refused',
  'consult_booked',
  'consult_done',
  'rx_issued',
  'dispensing',
  'delivered',
  'active_member',
] as const;

export type JourneyState = (typeof JOURNEY_STATES)[number];

export const LANES = ['fast', 'full'] as const;
export type Lane = (typeof LANES)[number];
