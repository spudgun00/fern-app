-- Fern patient zone — shop S2: the unified cart.
--
-- One basket per patient holding TYPED line items: an OTC line (a food-supplement /
-- intimate-care product from the OTC catalogue) or a PRESCRIPTION line (a treatment
-- product that enters the clinician-reviewed journey). The cart is the pre-payment
-- staging table; S3's unified checkout reads it, takes ONE payment, then routes each
-- line by its type (OTC -> mock dispatch now; prescription -> the existing journey).
--
-- cart_item is a NON-CLINICAL POINTER row only: which account, the line type, and a
-- pointer (ref_id) to the catalogue product (a slug like 'vitamin-d3' or
-- 'menopause_screen'). NO card data, NO PII, NO Article 9 clinical content. The
-- product name / price / description are resolved from the flag-gated catalogues at
-- render time, never copied here. A prescription line is only ENTRY to the journey;
-- it never carries a script, a decision, or any clinical state (that lives behind the
-- adapters exactly as before). The same hard line as payment_ref / checkout_consent.
--
-- One row per (account, type, ref): re-adding a line is a no-op (unique index). No
-- quantity in S2 (a line is present or absent).
create table if not exists cart_item (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references account (id) on delete cascade,
  line_type text not null check (line_type in ('otc', 'prescription')),
  ref_id text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists cart_item_account_line_uniq
  on cart_item (account_id, line_type, ref_id);
comment on table cart_item is
  'NON-CLINICAL cart line pointer. account + line_type (otc|prescription) + ref_id (catalogue slug). No card data, no PII, no Article 9. Product detail is resolved from the flag-gated catalogues at render, never stored. A prescription line is entry to the journey only; it holds no clinical state.';
alter table cart_item enable row level security;
