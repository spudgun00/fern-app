-- Fern patient zone — P0 foundation schema.
--
-- HARD RULE: the app-DB tables below hold NO UK GDPR Article 9 / clinical
-- content. Clinical content (intake answers, notes, scripts) lives ONLY behind
-- the ClinicalCoreAdapter. This phase that adapter is MockCore, persisting to
-- the namespaced mock_* tables further down, which are a THROWAWAY dev stand-in
-- for the rented clinical core and are deleted when the real core is wired.
--
-- ACCESS + RLS: RLS is enabled on EVERY table with NO permissive policies, so
-- no table is client-readable. All access this phase is server-side via the
-- service_role admin client, which bypasses RLS.

-- ---------------------------------------------------------------------------
-- enums
-- ---------------------------------------------------------------------------
create type journey_state as enum (
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
  'active_member'
);
create type account_role as enum ('patient', 'clinician');
create type lane_type as enum ('fast', 'full');
create type payment_kind as enum ('consult', 'membership');

-- ---------------------------------------------------------------------------
-- app DB — NON-CLINICAL STATE ONLY
-- ---------------------------------------------------------------------------

-- account: links a Supabase auth user to app state.
create table account (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique,
  role account_role not null default 'patient',
  core_patient_id uuid, -- pointer into the clinical core; NOT clinical content
  created_at timestamptz not null default now()
);
comment on table account is
  'NON-CLINICAL app state only. No Article 9 content. core_patient_id is a pointer into the clinical core (resolved via the ClinicalCoreAdapter), not clinical content.';
alter table account enable row level security;

-- journey: the state-machine position for an account.
create table journey (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references account (id) on delete cascade,
  state journey_state not null default 'registered',
  lane lane_type,
  updated_at timestamptz not null default now()
);
comment on table journey is
  'NON-CLINICAL app state only. No Article 9 content. Tracks journey state machine position.';
alter table journey enable row level security;

-- queue_item: POINTERS ONLY into the core review queue.
create table queue_item (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references account (id) on delete cascade,
  intake_id uuid not null, -- pointer into the core; clinical detail is read from the core for display
  lane lane_type not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
comment on table queue_item is
  'POINTERS ONLY. No clinical answers and no clinically-meaningful flags. Clinical detail is read from the core for display, never copied here.';
alter table queue_item enable row level security;

-- booking_ref: schema only this phase.
create table booking_ref (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references account (id) on delete cascade,
  provider_ref text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
comment on table booking_ref is
  'NON-CLINICAL app state only. No Article 9 content. Schema only in P0.';
alter table booking_ref enable row level security;

-- payment_ref: schema only this phase.
create table payment_ref (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references account (id) on delete cascade,
  provider_ref text,
  kind payment_kind not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
comment on table payment_ref is
  'NON-CLINICAL app state only. No Article 9 content. Schema only in P0.';
alter table payment_ref enable row level security;

-- ---------------------------------------------------------------------------
-- mock_* tables — THROWAWAY DEV STAND-IN for the rented clinical core / CloudRx.
--
-- NOT the production data model. They hold fake, dev-only, clinical-SHAPED data
-- so adapter round-trips survive across requests and are inspectable. This is
-- the ONE place mock clinical-shaped data may sit in Supabase: fake, dev-only,
-- and namespaced. Deleted when the real core + real CloudRx are wired behind
-- the same adapter interfaces.
-- ---------------------------------------------------------------------------

create table mock_core_patient (
  id uuid primary key default gen_random_uuid(),
  profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
comment on table mock_core_patient is
  'THROWAWAY dev stand-in for the rented clinical core. Fake, dev-only, namespaced. Deleted when the real core is wired.';
alter table mock_core_patient enable row level security;

create table mock_core_intake (
  id uuid primary key default gen_random_uuid(),
  core_patient_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'submitted',
  lane lane_type,
  created_at timestamptz not null default now()
);
comment on table mock_core_intake is
  'THROWAWAY dev stand-in for the rented clinical core. Fake, dev-only, namespaced. Deleted when the real core is wired.';
alter table mock_core_intake enable row level security;

create table mock_core_consult_note (
  id uuid primary key default gen_random_uuid(),
  core_patient_id uuid not null,
  note jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
comment on table mock_core_consult_note is
  'THROWAWAY dev stand-in for the rented clinical core. Fake, dev-only, namespaced. Deleted when the real core is wired.';
alter table mock_core_consult_note enable row level security;

create table mock_core_prescription (
  id uuid primary key default gen_random_uuid(),
  core_patient_id uuid not null,
  rx jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
comment on table mock_core_prescription is
  'THROWAWAY dev stand-in for the rented clinical core. Fake, dev-only, namespaced. Deleted when the real core is wired.';
alter table mock_core_prescription enable row level security;

create table mock_core_repeat_request (
  id uuid primary key default gen_random_uuid(),
  core_patient_id uuid not null,
  rx_ref text not null,
  created_at timestamptz not null default now()
);
comment on table mock_core_repeat_request is
  'THROWAWAY dev stand-in for the rented clinical core. Fake, dev-only, namespaced. Deleted when the real core is wired.';
alter table mock_core_repeat_request enable row level security;

create table mock_dispense (
  id uuid primary key default gen_random_uuid(),
  rx jsonb not null default '{}'::jsonb,
  status text not null default 'submitted',
  tracking jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
comment on table mock_dispense is
  'THROWAWAY dev stand-in for the CloudRx dispensing API. Fake, dev-only, namespaced. Deleted when the real CloudRx adapter is wired.';
alter table mock_dispense enable row level security;
