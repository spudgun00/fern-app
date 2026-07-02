-- Fern patient zone — checkout C2: shared one-off checkout (journeys A + B).
--
-- The one-off pay-first checkout (Midlife Health Screen / weight treatment, both
-- transmitted through the existing 'treatment' payment_kind) needs an explicit,
-- timestamped record that the patient consented at the point of paying, the same
-- discipline the marketing waitlist holds. This adds ONE non-clinical pointer
-- table for that consent.
--
-- checkout_consent is a POINTER + timestamp only: which account, which product
-- descriptor id (free text, e.g. 'menopause_screen' / 'weight_treatment'), and a
-- pointer to the provider checkout session it was captured against. NO card data,
-- NO PII, NO Article 9 clinical content — the same hard line as payment_ref /
-- membership. The payment itself still flows through payment_ref (kind
-- 'treatment'); this only records that consent was given, and when.
create table if not exists checkout_consent (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references account (id) on delete cascade,
  product text not null,
  provider_ref text,
  created_at timestamptz not null default now()
);
comment on table checkout_consent is
  'NON-CLINICAL consent record. Explicit, timestamped consent captured at checkout (waitlist discipline). Pointer + product id + session pointer only. No Article 9, no card data, no PII.';
alter table checkout_consent enable row level security;
