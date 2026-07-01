-- Fern patient zone — Screening schema (weight roadmap P2: screening-before-
-- prescribing). Adds the at-home blood-test screening branch that sits between
-- intake_submitted and the clinician decision, and is the mandatory precondition
-- of a prescribing decision for a screening-required (weight) patient.
--
-- HARD RULES (same as P0..P6, restated because they bind these tables):
--   * NO UK GDPR Article 9 / clinical content in app-DB tables. The blood-test
--     RESULTS (the panel values) are clinical content and live ONLY behind the
--     ScreeningAdapter (this phase: MockScreening -> the mock_screening stand-in
--     table). screening_ref stores ONLY pointers + a coarse administrative status.
--   * screening_ref columns are POINTERS + administrative status ONLY:
--       - kit_ref : pointer into the screening provider (lab / mock); NOT a result.
--       - status  : coarse workflow status (kit_sent | sample_received |
--                   results_ready), mirroring the journey, NOT a clinical value.
--     No marker values, no reference ranges, no clinical detail ever land here. A
--     test asserts the column set never grows to include such fields.
--   * The bloods are an INPUT to the clinician's decision, never a decision-maker:
--     nothing here auto-approves or auto-issues. RX_ISSUED_PREDECESSORS is
--     unchanged (still exactly {approved, consult_done}); this branch only gates
--     WHEN the clinician may decide, it never makes the decision.
--   * RLS enabled with NO permissive policies; all access is server-side via the
--     service_role admin client (bypasses RLS).

-- ---------------------------------------------------------------------------
-- journey enum: the screening branch, inserted after intake_submitted. These are
-- additive enum values (ADD VALUE IF NOT EXISTS, positioned for readability). No
-- existing value/transition changes; the rx_issued hard line is untouched.
-- ---------------------------------------------------------------------------
alter type journey_state add value if not exists 'screening_kit_sent' after 'intake_submitted';
alter type journey_state add value if not exists 'sample_received' after 'screening_kit_sent';
alter type journey_state add value if not exists 'results_ready' after 'sample_received';

-- ---------------------------------------------------------------------------
-- app DB — NON-CLINICAL STATE ONLY
-- ---------------------------------------------------------------------------

-- screening_ref: POINTER + SCREENING STATUS ONLY for a patient's at-home blood
-- test. Deliberately has no columns for marker values, ranges, or any clinical
-- detail; the schema itself is the guarantee. The panel results live behind the
-- ScreeningAdapter (mock_screening this phase), never here.
create table screening_ref (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references account (id) on delete cascade,
  kit_ref uuid not null,       -- pointer into the screening provider (lab / mock); NOT a result
  status text not null default 'kit_sent',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table screening_ref is
  'POINTER + SCREENING STATUS ONLY. No marker values, no ranges, no clinical detail. The blood-test results live behind the ScreeningAdapter (mock_screening this phase), never here.';
comment on column screening_ref.kit_ref is
  'Pointer into the screening provider record (lab / mock). The results live with the provider, never here.';
alter table screening_ref enable row level security;

-- ---------------------------------------------------------------------------
-- mock_* table — THROWAWAY DEV STAND-IN for the screening lab partner.
-- Holds fake, dev-only, clinical-SHAPED data (the panel) so adapter round-trips
-- survive across requests and are inspectable. Namespaced; deleted when the real
-- UKAS-accredited lab adapter is wired behind the ScreeningAdapter interface.
-- ---------------------------------------------------------------------------
create table mock_screening (
  id uuid primary key default gen_random_uuid(),
  core_patient_id uuid not null,
  status text not null default 'kit_sent',
  results jsonb not null default '{}'::jsonb,  -- fake panel; clinical-shaped, lives ONLY behind the adapter
  created_at timestamptz not null default now()
);
comment on table mock_screening is
  'THROWAWAY dev stand-in for the screening lab partner. Fake, dev-only, namespaced. The panel results are clinical-shaped and live ONLY behind the ScreeningAdapter. Deleted when the real lab adapter is wired.';
alter table mock_screening enable row level security;
