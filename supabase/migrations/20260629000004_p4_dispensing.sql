-- Fern patient zone — P4 schema: dispensing pointer.
--
-- P4 transmits a clinician-issued script to dispensing (CloudRx, mocked behind
-- the DispensingAdapter) and lets the patient see status + tracking. It adds NO
-- new journey state (the machine already carries rx_issued -> dispensing ->
-- delivered) and ONE new app-DB pointer table.
--
-- HARD RULES (same as P0..P3, restated because they bind this table):
--   * NO UK GDPR Article 9 / clinical content in app-DB tables. The issued
--     script and the pharmacy dispensing record live ONLY behind the
--     DispensingAdapter (this phase: MockDispensing -> the mock_dispense stand-in
--     table). dispense_ref stores ONLY pointers + a coarse administrative status.
--   * The columns below are POINTERS + administrative status ONLY:
--       - rx_ref      : pointer to the core prescription the dispense is for.
--       - dispense_id : pointer into the dispensing provider (CloudRx / mock).
--       - status      : coarse workflow status (submitted | dispatched |
--                       delivered), mirroring the journey, NOT a clinical flag.
--     No medicine names, no doses, no clinical detail ever land here. A test
--     asserts the column set never grows to include such fields.
--   * RLS enabled with NO permissive policies; all access is server-side via the
--     service_role admin client (bypasses RLS).

-- ---------------------------------------------------------------------------
-- app DB — NON-CLINICAL STATE ONLY
-- ---------------------------------------------------------------------------

-- dispense_ref: POINTER + DISPENSING STATUS ONLY for an issued script that has
-- been transmitted to the pharmacy. Deliberately has no columns for medicine
-- names, doses, or any clinical detail; the schema itself is the guarantee. The
-- script + the pharmacy record live in the core / dispensing provider.
create table dispense_ref (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references account (id) on delete cascade,
  rx_ref uuid not null,       -- pointer into the core (prescription); NOT clinical content
  dispense_id uuid not null,  -- pointer into the dispensing provider (CloudRx / mock); NOT clinical content
  status text not null default 'submitted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table dispense_ref is
  'POINTER + DISPENSING STATUS ONLY. No medicine names, no doses, no clinical detail. The script + pharmacy record live behind the DispensingAdapter (mock_dispense this phase), never here.';
comment on column dispense_ref.rx_ref is
  'Pointer to the core prescription the dispense is for. The script lives in the core, never here.';
comment on column dispense_ref.dispense_id is
  'Pointer into the dispensing provider record (CloudRx / mock). The pharmacy record lives with the provider, never here.';
alter table dispense_ref enable row level security;
