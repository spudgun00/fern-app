-- Fern patient zone — P5 schema: payment + membership.
--
-- P5 adds the money model: a one-off consult fee (Stripe Checkout, ~£100) and a
-- recurring membership (Stripe Billing, ~£18/mo) with first-vs-repeat tiering.
-- It adds NO new journey state (the machine already carries delivered ->
-- active_member) and ONE new app-DB pointer table (membership), reusing the
-- P0 payment_ref table for the one-off consult fee.
--
-- HARD RULES (same as P0..P4, restated because they bind these tables):
--   * NO UK GDPR Article 9 / clinical content in app-DB tables. Nothing here is
--     clinical: these are billing pointers + a coarse status.
--   * NO card data, NO PII (name, address, card). The payment method and the
--     customer record live ONLY with the provider (Stripe), behind the
--     PaymentsAdapter. The app DB stores provider POINTERS + status only:
--       - payment_ref.provider_ref        : the Checkout session / payment id.
--       - membership.provider_customer_ref : the Stripe customer id (for the portal).
--       - membership.provider_subscription_ref : the Stripe subscription id.
--       - *.status                         : coarse billing status, NOT clinical.
--     A test asserts the membership column set never grows to card / PII detail.
--   * RLS enabled with NO permissive policies; all access is server-side via the
--     service_role admin client (bypasses RLS).

-- ---------------------------------------------------------------------------
-- app DB — NON-CLINICAL STATE ONLY (billing pointers + status)
-- ---------------------------------------------------------------------------

-- membership: POINTER + BILLING STATUS ONLY for a patient's recurring membership
-- subscription. The Stripe customer + subscription + payment method live with
-- the provider; this row holds only their ids and a coarse status. One row per
-- account (the latest subscription state).
create table membership (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references account (id) on delete cascade,
  provider_customer_ref text,      -- Stripe customer id (pointer, for the portal); NOT PII
  provider_subscription_ref text,  -- Stripe subscription id (pointer); NOT PII
  status text not null default 'inactive', -- inactive | active | canceled (coarse billing status)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table membership is
  'POINTER + BILLING STATUS ONLY. No card data, no PII. The customer + subscription + payment method live with the provider (Stripe), never here. status drives active_member access.';
comment on column membership.provider_customer_ref is
  'Stripe customer id (pointer, used to open the billing portal). The customer record lives with Stripe, never here.';
comment on column membership.provider_subscription_ref is
  'Stripe subscription id (pointer). The subscription lives with Stripe, never here.';
alter table membership enable row level security;

-- ---------------------------------------------------------------------------
-- mock_* table — THROWAWAY DEV STAND-IN for the Stripe Checkout / Billing API.
--
-- Models the PROVIDER's side of a checkout session (like mock_identity_verification
-- for Stripe Identity), so the mock payment flow is walkable end to end on the
-- deployed URL with no Stripe keys. Holds fake, dev-only billing-shaped data:
-- NO card data (the mock has none). Deleted when the real Stripe adapter is wired.
-- ---------------------------------------------------------------------------
create table mock_payment_session (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  kind text not null,                 -- 'consult' | 'membership'
  status text not null default 'open', -- open | complete | expired
  customer_ref text,                  -- minted on completion of a membership checkout
  subscription_ref text,              -- minted on completion of a membership checkout
  created_at timestamptz not null default now()
);
comment on table mock_payment_session is
  'THROWAWAY dev stand-in for the Stripe Checkout/Billing API. Fake, dev-only, namespaced. No card data. Deleted when the real Stripe adapter is wired.';
alter table mock_payment_session enable row level security;
