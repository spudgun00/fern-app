-- Fern patient zone — shop S3: unified checkout + fulfilment router.
--
-- The mixed basket pays ONCE (one provider payment for the whole basket) and the
-- fulfilment router then routes each line by its type: OTC lines dispatch now
-- (mock "ships now"); prescription lines enter the existing clinician-reviewed
-- journey, gated exactly as today. Two additive pieces, both NON-CLINICAL:
--
-- 1. A new payment_kind 'basket' — the single basket-level payment record (the one
--    charge the patient makes). Additive enum value; reuses the payment_ref pointer
--    table (provider pointer + coarse status only). For a basket that contains a
--    prescription line the router ALSO records the existing per-line kind
--    ('treatment') against the same provider session, so the built screening gate +
--    the P4 refund-on-refusal apply UNCHANGED (a clinician still decides; the
--    charge only gates entry to the journey, never rx_issued).
--
-- 2. otc_fulfilment — a mock dispatch record per OTC line: which account, the OTC
--    catalogue slug (ref_id), a pointer to the basket payment session (provider_ref),
--    and a coarse status ('dispatched'). This is the "ships now" leg. It touches NO
--    clinical state and is tracked entirely independently of the prescription lines,
--    so refunding a refused prescription line never affects a shipped OTC line.
--    No product name / price / claim is stored (resolved from the flag-gated
--    catalogue at render); NO card data, NO PII, NO Article 9.
--
-- HARD LINE (restated): the basket payment gates OTC fulfilment + ENTRY to the
-- prescription journey. It is NEVER a predecessor of rx_issued.
-- RX_ISSUED_PREDECESSORS stays {approved, consult_done}.
alter type payment_kind add value if not exists 'basket';

create table if not exists otc_fulfilment (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references account (id) on delete cascade,
  ref_id text not null,
  provider_ref text,
  status text not null default 'dispatched',
  created_at timestamptz not null default now()
);
-- Idempotency: one dispatch per (account, basket session, OTC line) so a re-poll /
-- webroute re-fire does not duplicate the shipment.
create unique index if not exists otc_fulfilment_account_session_ref_uniq
  on otc_fulfilment (account_id, provider_ref, ref_id);
comment on table otc_fulfilment is
  'NON-CLINICAL OTC dispatch record ("ships now"). account + OTC catalogue slug + basket session pointer + coarse status. No product detail, no card data, no PII, no Article 9. Independent of the prescription lines.';
alter table otc_fulfilment enable row level security;
