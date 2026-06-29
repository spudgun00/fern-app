-- Fern patient zone — P1 schema: account + ID verification.
--
-- HARD RULES (same as P0, restated because they bind these tables):
--   * NO UK GDPR Article 9 / clinical content in app-DB tables. P1 captures no
--     clinical data at all. Patient demographics (name / DOB / contact) live in
--     the clinical core via createPatient, NOT here.
--   * id_verification stores ONLY a provider session pointer + status. NO
--     document images and NO extracted ID PII (name / DOB / selfie) ever land
--     in the app DB; that data stays with the identity provider (Stripe).
--   * GP info-sharing is captured as consent OR an explicit refusal carrying a
--     recorded risk note. This is administrative consent, not clinical content.
--   * RLS enabled on EVERY table with NO permissive policies. All access is
--     server-side via the service_role admin client (bypasses RLS).

-- ---------------------------------------------------------------------------
-- enums
-- ---------------------------------------------------------------------------
create type gp_sharing_decision as enum ('consent', 'refused');

-- ---------------------------------------------------------------------------
-- app DB — NON-CLINICAL STATE ONLY
-- ---------------------------------------------------------------------------

-- gp_sharing: the patient's GP info-sharing decision. A 'refused' row MUST
-- carry a non-null, non-empty risk_note (enforced by the CHECK below and in
-- recordGpSharing). Administrative consent state, not clinical content.
create table gp_sharing (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references account (id) on delete cascade,
  decision gp_sharing_decision not null,
  risk_note text,
  recorded_at timestamptz not null default now(),
  constraint gp_sharing_refusal_requires_note check (
    decision = 'consent' or (risk_note is not null and length(btrim(risk_note)) > 0)
  )
);
comment on table gp_sharing is
  'NON-CLINICAL consent state. No Article 9 content. A refusal must carry a recorded risk note (hard line, enforced by CHECK).';
alter table gp_sharing enable row level security;

-- id_verification: POINTER + STATUS ONLY for an identity-provider session.
-- Deliberately has no columns for document images or extracted PII; the schema
-- itself is the guarantee. A test asserts the column set never grows to include
-- such fields.
create table id_verification (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references account (id) on delete cascade,
  provider_ref text not null,
  status text not null default 'requires_input',
  created_at timestamptz not null default now()
);
comment on table id_verification is
  'POINTER + STATUS ONLY. No document images, no extracted ID PII (name/DOB/selfie). That data stays with the provider behind the IdentityAdapter.';
alter table id_verification enable row level security;

-- ---------------------------------------------------------------------------
-- mock_identity_verification — THROWAWAY DEV STAND-IN for the identity provider
-- (Stripe Identity). Models the PROVIDER's own session record, not app-DB
-- state. Holds a session id + status only; like Stripe it holds no PII. Deleted
-- when the real provider is wired behind the same IdentityAdapter interface.
-- ---------------------------------------------------------------------------
create table mock_identity_verification (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  status text not null default 'requires_input',
  created_at timestamptz not null default now()
);
comment on table mock_identity_verification is
  'THROWAWAY dev stand-in for the identity provider. Provider-side session record, fake + dev-only + namespaced. Deleted when the real provider is wired.';
alter table mock_identity_verification enable row level security;
