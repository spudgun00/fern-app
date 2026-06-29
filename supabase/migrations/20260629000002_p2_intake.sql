-- Fern patient zone — P2 schema: intake routing pointer.
--
-- HARD RULES (same as P0/P1, restated because they bind this table):
--   * NO UK GDPR Article 9 / clinical content in app-DB tables. The structured
--     intake ANSWERS and the routing REASONS live ONLY in the clinical core via
--     saveIntake, behind the ClinicalCoreAdapter. They are NEVER copied here.
--   * intake_ref stores ONLY a pointer to the core intake (intake_id), the
--     routing OUTCOME (which lane, or a stop) and a status. No answers, no
--     clinically-meaningful flags. The lane/outcome is an administrative routing
--     decision ("the next step, never a diagnosis"), consistent with the
--     existing journey.lane / queue_item.lane columns.
--   * RLS enabled on EVERY table with NO permissive policies. All access is
--     server-side via the service_role admin client (bypasses RLS).

-- ---------------------------------------------------------------------------
-- enums
-- ---------------------------------------------------------------------------
-- 'fast' / 'full' are the two lanes; 'stop' is a red-flag signpost (no lane).
create type intake_outcome as enum ('fast', 'full', 'stop');

-- ---------------------------------------------------------------------------
-- app DB — NON-CLINICAL STATE ONLY
-- ---------------------------------------------------------------------------

-- intake_ref: POINTER + ROUTING OUTCOME ONLY for a submitted intake. Deliberately
-- has no columns for answers or clinical reasons; the schema itself is the
-- guarantee. A test asserts the column set never grows to include such fields.
create table intake_ref (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references account (id) on delete cascade,
  intake_id uuid not null, -- pointer into the core; answers are read from the core for display, never copied here
  outcome intake_outcome not null,
  status text not null default 'submitted',
  created_at timestamptz not null default now()
);
comment on table intake_ref is
  'POINTER + ROUTING OUTCOME ONLY. No clinical answers and no clinical reasons. The structured intake lives in the clinical core via the ClinicalCoreAdapter.';
alter table intake_ref enable row level security;
