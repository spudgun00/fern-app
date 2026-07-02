-- Fern patient zone — checkout C4: one payments customer per patient.
--
-- The checkout spec (s4) requires ONE provider (Stripe) customer per patient, so
-- the one-off charges (consult / treatment), the subscription (membership), and
-- the billing portal all attach to the SAME customer. P5 stored the customer id
-- only on the membership row (minted at the subscription checkout); this adds a
-- per-account customer POINTER created at (or before) the first checkout of any
-- kind and reused for every later one, so a patient who pays a one-off and later
-- subscribes has a single customer.
--
-- payments_customer is a POINTER only: which account, the provider customer id.
-- NO card data, NO PII (the customer RECORD, name, address, payment method live
-- with the provider behind the PaymentsAdapter) — the same hard line as
-- payment_ref / membership. One row per account.
create table if not exists payments_customer (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references account (id) on delete cascade,
  provider_customer_ref text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table payments_customer is
  'POINTER ONLY: the single provider (Stripe) customer id per patient, reused across one-offs + subscription + portal. No card data, no PII. The customer record lives with the provider.';
alter table payments_customer enable row level security;
