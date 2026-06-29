-- Fern patient zone — P3 schema: clinician decision audit pointers.
--
-- P3 is the clinician console (review queue + async approve + script issue). It
-- adds NO new journey state (the machine already carries approved / escalated /
-- refused / rx_issued) and NO new app-DB table. It only records, against the
-- existing queue_item pointer, WHO decided, WHEN, and POINTERS to the core
-- artifacts the decision produced.
--
-- HARD RULES (same as P0..P2, restated because they bind these columns):
--   * NO UK GDPR Article 9 / clinical content in app-DB tables. The clinician's
--     RATIONALE / reason is clinical reasoning and lives ONLY in the core, as a
--     consult note via createConsultNote (behind the ClinicalCoreAdapter). The
--     issued script lives ONLY in the core via issuePrescription.
--   * The columns below are POINTERS + administrative status ONLY:
--       - decided_by : the deciding clinician's app account id (a pointer, no
--                      real clinician identity, no name / GMC number).
--       - decided_at : timestamp of the decision.
--       - note_ref   : pointer to the core consult note holding the rationale.
--       - rx_ref     : pointer to the core prescription (null unless approved).
--     No reason text, no clinical flags, no answers ever land here.
--   * queue_item.status moves pending -> approved | escalated | refused, mirroring
--     the journey state, which already legally carries those values. This is the
--     same administrative routing/workflow status, not a clinical flag.
--   * RLS stays enabled with NO permissive policies; all access is server-side
--     via the service_role admin client.

alter table queue_item
  add column decided_by uuid references account (id) on delete set null,
  add column decided_at timestamptz,
  add column note_ref uuid, -- pointer into the core (consult note); NOT clinical content
  add column rx_ref uuid;   -- pointer into the core (prescription); NOT clinical content

comment on column queue_item.decided_by is
  'Pointer to the deciding clinician''s app account. No real clinician identity (no name/GMC).';
comment on column queue_item.note_ref is
  'Pointer to the core consult note holding the clinician rationale. The rationale itself lives in the core, never here.';
comment on column queue_item.rx_ref is
  'Pointer to the core prescription issued on approve (null otherwise). The script lives in the core, never here.';
