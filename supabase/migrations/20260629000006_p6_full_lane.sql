-- Fern patient zone — P6 schema: the full (assessed) lane — booking + video.
--
-- P6 closes the initiation path: book a consult slot (Cal.com), join a video
-- room (Daily), and a clinician takes the SAME decision as P3 (issue / refuse)
-- at consult_done. It adds NO new journey state (the machine already carries
-- intake_submitted/escalated -> consult_booked -> consult_done -> rx_issued; P6
-- adds only the in-code transition consult_done -> refused, no new enum value)
-- and NO new app-DB table for the booking itself: it EXTENDS the P0 booking_ref
-- pointer table with scheduling + video + decision-audit pointers, mirroring how
-- P3 extended queue_item with decision-audit columns.
--
-- HARD RULES (same as P0..P5, restated because they bind these columns):
--   * NO UK GDPR Article 9 / clinical content in app-DB tables. The clinician's
--     consult RATIONALE lives ONLY in the core, as a consult note via
--     createConsultNote; the issued script lives ONLY in the core via
--     issuePrescription. The video call content lives ONLY with the provider.
--   * The columns below are POINTERS + administrative status ONLY:
--       - provider_ref : the Cal.com booking id (pointer); already on booking_ref.
--       - slot_at      : the booked appointment time (non-clinical scheduling).
--       - room_ref     : pointer to the Daily video room (a join pointer, not
--                        call content). The room + recording (if any) live with
--                        the provider, never here.
--       - decided_by   : the deciding clinician's app account id (a pointer; no
--                        real clinician identity, no name / GMC number).
--       - decided_at   : timestamp of the consult decision.
--       - note_ref     : pointer to the core consult note holding the rationale.
--       - rx_ref       : pointer to the core prescription (null unless issued).
--     No reason text, no clinical flags, no answers, no card / PII ever land here.
--   * booking_ref.status moves pending -> booked -> (issued | refused), the same
--     administrative workflow status pattern as queue_item (pending -> approved |
--     escalated | refused). It is not a clinical flag.
--   * RLS stays enabled with NO permissive policies; all access is server-side
--     via the service_role admin client.

-- ---------------------------------------------------------------------------
-- app DB — extend booking_ref (POINTERS + scheduling/decision status ONLY)
-- ---------------------------------------------------------------------------
alter table booking_ref
  add column slot_at timestamptz,                                    -- booked appointment time (non-clinical)
  add column room_ref text,                                          -- pointer to the video room (join pointer)
  add column decided_by uuid references account (id) on delete set null,
  add column decided_at timestamptz,
  add column note_ref uuid,  -- pointer into the core (consult note); NOT clinical content
  add column rx_ref uuid;    -- pointer into the core (prescription); NOT clinical content

comment on column booking_ref.slot_at is
  'Booked appointment time. Non-clinical scheduling metadata, not Article 9 content.';
comment on column booking_ref.room_ref is
  'Pointer to the video room (a join pointer). The call + any recording live with the video provider, never here.';
comment on column booking_ref.decided_by is
  'Pointer to the deciding clinician''s app account. No real clinician identity (no name/GMC).';
comment on column booking_ref.note_ref is
  'Pointer to the core consult note holding the clinician rationale. The rationale itself lives in the core, never here.';
comment on column booking_ref.rx_ref is
  'Pointer to the core prescription issued on a consult (null otherwise). The script lives in the core, never here.';

-- ---------------------------------------------------------------------------
-- mock_* table — THROWAWAY DEV STAND-IN for the Cal.com booking API.
--
-- Models the PROVIDER's side of a booking (like mock_payment_session for Stripe
-- Checkout): the slot is chosen here in the mock flow. Holds fake, dev-only
-- scheduling-shaped data and NO PII. Deleted when the real Cal.com adapter is
-- wired behind the same BookingAdapter interface.
--
-- (Video has no mock table: MockVideo is stateless — the join URL is fully
-- derived from the room ref, so there is no provider record to stand in for.)
-- ---------------------------------------------------------------------------
create table mock_booking_session (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  status text not null default 'pending', -- pending | booked | canceled
  slot_at timestamptz,                     -- set when the mock slot is chosen
  created_at timestamptz not null default now()
);
comment on table mock_booking_session is
  'THROWAWAY dev stand-in for the Cal.com booking API. Fake, dev-only, namespaced. No PII. Deleted when the real Cal.com adapter is wired.';
alter table mock_booking_session enable row level security;
