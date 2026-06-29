# CLAUDE.md

Guidance for Claude Code working in this repo (the Fern patient zone app).

## What this is

The authenticated patient + clinician app, a **separate repo and deployment**
from the static marketing site at `fern.care`. Auth, secrets, and per-user data
live only here. Authoritative spec: `docs/fern-patient-zone-build-spec.md` — read
it before building. Build is phased (P0…P7); **build one phase, prove its success
test on the deployed URL, then stop**. Do not build ahead of a passing test.

Status: **P5 built** (payment + membership + repeat tiering — **money closes**),
deployed at https://fern-app.jimgill.workers.dev. P0 (foundation + adapter spine +
mocks), P1 (account + ID verification), P2 (two-lane intake + deterministic
routing), P3 (clinician console — fast lane closes) and P4 (script to CloudRx +
patient dispensing status — dispensing closes) done. Success tests A (`npm test`,
55 passed) and B pass. P5's test proved on the deployed URL: paying the consult
fee (mock Checkout) flips the `hasPaidConsult` gate; subscribing to membership
(mock Checkout subscription) activates membership and advances `delivered ->
active_member`; a member's repeat reaches the clinician review queue with no new
consult charge while a non-member's repeat is gated; and cancelling via the
(mock) portal flips membership to `canceled` (the member loses the no-charge
repeat). P1's Test C (real Stripe Identity test-mode path) and P5's real Stripe
Checkout/Billing path are both wired-but-unclosed (need the Stripe test secrets
set, see below). P6+ not started.

## Stack

- Astro `output: 'server'` on **Cloudflare Workers** via `@astrojs/cloudflare` (v14+).
- **Supabase** (EU, project ref `fvpmjlrtfvjxpiilzmtb`): auth + non-clinical app DB.
  `@supabase/ssr` cookie sessions (anon key) for auth; a separate service_role
  admin client for privileged server-side writes.
- Vitest.

## Architecture (the spine)

All clinical-record + dispensing operations go through one adapter interface so
the app stays record-host-agnostic until the real core is chosen.

- Adapters: `src/lib/adapters/` — `ClinicalCoreAdapter`, `DispensingAdapter`,
  `IdentityAdapter`, `PaymentsAdapter`, `MockCore` (Supabase `mock_*` tables),
  `MockCoreB` (in-memory), `MockDispensing`, `MockIdentity` (mock provider,
  `mock_identity_*`), `MockPayments` (mock provider, `mock_payment_session`),
  `StripeIdentity` and `StripePayments` (real, Stripe REST via fetch, no Node SDK).
- Factory: `getClinicalCore()` / `getDispensing()` / `getIdentity()` /
  `getPayments()` pick the impl from `CORE_IMPL` / `DISPENSING_IMPL` /
  `IDENTITY_IMPL` / `PAYMENTS_IMPL` (default `mock`). Never branch on the impl
  anywhere else (the dev harness + the mock-confirm / mock-portal-cancel routes do
  an `instanceof Mock*` check to complete the mock flow server-side; that is a
  mock-only test affordance, not business logic).
- Journey state machine: `src/lib/journey/`. Illegal transitions throw.
- Intake routing (P2): `src/lib/intake/` — `routing.ts` is the deterministic,
  pure `routeIntake(answers)` (the single source of routing truth: fast / full /
  stop with reasons + signpost; red flags take precedence; HRT initiation leans
  full); `questionnaire.ts` is the static screening config + form parser;
  `submit.ts` orchestrates saveIntake -> journey advance -> `intake_ref`. Answers
  (Article 9) and routing reasons live only in the core; the app DB holds only
  the `intake_ref` pointer + outcome. Lane -> journey-state mapping (no new enum
  state was added; the machine stays spec-exact): **fast** -> `in_review_queue`
  (lane `fast`) + a `queue_item` pointer; **full** -> stays `intake_submitted`
  (lane `full`) until P6 books the slot (`intake_submitted -> consult_booked`);
  **stop** -> stays `intake_submitted` (lane `null`), no queue item, signpost
  shown. P3/P6 pick up from these.
- App-DB helpers: `src/lib/accounts.ts`. Env: `src/lib/env.ts`. Supabase clients:
  `src/lib/supabase/`. Per-request wiring: `src/middleware.ts`.

## Hard rules (in code, do not weaken)

- **A clinician makes every prescribing decision.** `rx_issued` is reachable
  ONLY from `approved` or `consult_done` in `ALLOWED_TRANSITIONS`; a test
  asserts no other predecessor exists. No questionnaire-only auto-dispense.
- **Article 9 / clinical content lives only behind the clinical core adapter**,
  never in the app DB. App-DB tables (`account`, `journey`, `queue_item`,
  `gp_sharing`, `id_verification`, `intake_ref`, `booking_ref`, `payment_ref`)
  hold non-clinical state only; `queue_item` and `intake_ref` hold pointers +
  routing/status only (no answers, no clinical reasons). The `mock_*` tables are
  a throwaway dev stand-in, deleted when the real core is wired.
- **RLS on every table, no policies.** All access is server-side via the
  service_role admin client. The anon key is for auth only, never data reads.
- `SUPABASE_SERVICE_KEY` is server-only — never `PUBLIC_`, never in a client bundle.
- No real clinician identity in the product. No live care pre-CQC; build/test
  against mocks only.

## Conventions

- British English, no em dashes, no emoji in product copy.
- Match surrounding code style. P0 pages are intentionally unstyled (plumbing);
  the design system arrives with patient-facing screens in a later phase — reuse
  the marketing-site tokens then, do not invent a new palette.

## Commands

```sh
npm test                 # vitest: state machine + adapter round-trip (both impls)
npm run dev              # local dev (Cloudflare runtime; reads .dev.vars)
npm run build            # astro build
npm run deploy           # build + wrangler deploy
supabase db push         # apply migrations (prompts to confirm; pipe Y non-interactively)
```

After the first deploy, the three Supabase values are Worker **secrets**
(`wrangler secret put …`), never committed. Only non-secret flags live in
`wrangler.jsonc`. Local dev + tests read `.dev.vars` (gitignored).

**To activate the Stripe Identity path (test C):**
1. `wrangler secret put STRIPE_SECRET_KEY` (a `sk_test_…` key) and
   `wrangler secret put STRIPE_WEBHOOK_SECRET` (the `whsec_…` from the webhook
   endpoint below). These are required only when `IDENTITY_IMPL=stripe`; server
   only, never `PUBLIC_`.
2. In the Stripe dashboard add a webhook endpoint pointing at
   `https://fern-app.jimgill.workers.dev/api/webhooks/stripe-identity` for the
   `identity.verification_session.*` events; copy its signing secret into the
   secret above.
3. Set `IDENTITY_IMPL` to `stripe` in `wrangler.jsonc` `vars`, `npm run deploy`,
   then walk profile -> verify in a browser and complete Stripe's test-mode flow.
   The webhook (signature-verified) advances the journey to `id_verified`; the
   `/account/verify/complete` poll is an idempotent fallback.
Leave `IDENTITY_IMPL=mock` to keep the no-keys mock onboarding walk working.

**To activate the Stripe Checkout/Billing path (P5):** reuses the same Stripe
account/`STRIPE_SECRET_KEY` as Identity.
1. Create two test-mode Prices in Stripe (a one-off ~£100 consult, a ~£18/mo
   recurring membership) and `wrangler secret put STRIPE_PRICE_CONSULT` /
   `STRIPE_PRICE_MEMBERSHIP` with their `price_…` ids.
2. Add a webhook endpoint at
   `https://fern-app.jimgill.workers.dev/api/webhooks/stripe-billing` for
   `checkout.session.completed` + `customer.subscription.*`; copy its signing
   secret into `wrangler secret put STRIPE_BILLING_WEBHOOK_SECRET` (distinct from
   the identity webhook secret). Enable the customer portal in the Stripe dashboard.
3. Set `PAYMENTS_IMPL` to `stripe` in `wrangler.jsonc` `vars`, `npm run deploy`,
   then walk `/account/billing` and complete Stripe's test-mode checkout. The
   webhook activates membership + flips the consult gate; the
   `/account/billing/complete` poll is the idempotent fallback.
Leave `PAYMENTS_IMPL=mock` to keep the no-keys mock billing walk working.

## Runtime gotchas (cost real time in P0)

- **Env on Workers:** Astro v7 removed `Astro.locals.runtime.env`. Read bindings
  via `import { env } from 'cloudflare:workers'` (see `src/middleware.ts`), passed
  to `readEnv`. `readEnv` falls back to `process.env` for dev/tests.
- **CSRF:** Astro's default `checkOrigin` 403s form POSTs without an `Origin`
  header. Browsers send it; `curl` tests must add
  `-H "Origin: https://fern-app.jimgill.workers.dev"`. The Stripe webhook is
  exempt (it posts `application/json`, which `checkOrigin` does not guard); its
  auth is the HMAC signature check in `src/lib/stripe-webhook.ts` instead.
- **Adapter bindings:** image processing is `passthrough` (no IMAGES binding);
  Astro sessions need the `SESSION` KV namespace (bound in `wrangler.jsonc`).
- **Supabase keys** were not pre-filled in `.dev.vars`; fetch with
  `supabase projects api-keys --project-ref fvpmjlrtfvjxpiilzmtb -o json`.

## Runtime gotchas (cost real time in P1)

- **Build before you deploy.** Editing `wrangler.jsonc` alone does NOT change
  what ships. The `@astrojs/cloudflare` adapter compiles `wrangler.jsonc` into
  `dist/server/wrangler.json` at build time, and `wrangler deploy` reads *that*
  generated file, not your `wrangler.jsonc`. A bare `wrangler deploy` after a
  config edit ships the stale build. Always rebuild first; `npm run deploy`
  (`astro build && wrangler deploy`) folds this in, so use it and never call
  `wrangler deploy` standalone. This bit during the `IDENTITY_IMPL` flip.
- **Env keys via Worker secrets, not `vars`.** Secrets (`SUPABASE_SERVICE_KEY`,
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) are set with
  `wrangler secret put <NAME>` and live only in the Worker, never in
  `wrangler.jsonc` (which is committed). Only non-secret flags (the `*_IMPL`
  toggles) belong in `wrangler.jsonc` `vars`. Local dev + tests read the same
  keys from `.dev.vars` (gitignored). Never prefix a secret `PUBLIC_` or it
  lands in the client bundle.

## P2 done (intake + routing)

- **Added:** the two-lane menopause/HRT intake questionnaire + deterministic
  routing on top of the P1 spine.
- **Key pattern:** ALL routing lives in ONE pure function, `routeIntake` in
  `src/lib/intake/routing.ts` — the single source of routing truth, fully
  unit-tested. Precedence: red flag -> stop + signpost; HRT initiation / risk
  flag / incomplete safety picture -> full lane; clear continuing -> fast lane.
- **Three lane outcomes (proven on the live URL):** clear continuing -> fast
  (`in_review_queue` + a `queue_item`); risk flag -> full (`intake_submitted`,
  lane `full`, no `queue_item`); red flag -> stop (no lane, no `queue_item`,
  signpost shown).
- **Hard line held:** no questionnaire path advances past `in_review_queue` —
  nothing auto-approves or auto-scripts. The clinician decision is P3.
- **Boundary:** clinical answers + routing reasons live only in the core;
  `intake_ref` holds only a pointer + outcome (asserted by a denylist test).

## P3 done (clinician console — fast lane closes)

- **Added:** the clinician console — the review queue, the intake detail read
  from the core, and the action bar (**Approve + issue script** | **Escalate to
  consult** | **Refuse + signpost**). This closes the FAST lane end to end
  (intake -> clinician decision -> script).
- **Key pattern:** decision orchestration lives in ONE function,
  `decideClinicianAction` (`src/lib/clinician/decide.ts`). The transition to
  `rx_issued` is reachable ONLY through a clinician **Approve** action
  (`issuePrescription` is called from that branch alone; the journey machine
  independently bars `rx_issued` from any non-decision state).
- **Hard line, proven by four tests:** a non-clinician actor is rejected; a
  reason is required; no empty script is issued (approve needs an item); no
  double-decide on the same item.
- **Audit:** every decision records clinician + reason + timestamp on
  `queue_item` (decision-audit columns `decided_by` / `decided_at` / `note_ref`
  / `rx_ref` added in the P3 migration; pointers only — the rationale and script
  live in the core).
- **Three outcomes proven on the live URL:** approve -> `rx_issued`; escalate ->
  full lane (`escalated`, lane `full`); refuse -> terminal `refused` with a
  GP / NHS 111 signpost. A patient role hitting `/api/clinician/decide` is
  bounced with no decision. `npm test`: 43 passed.

## P4 done (script to CloudRx + patient dispensing status — dispensing closes)

- **Added:** the issued script flows to dispensing (CloudRx, mocked behind the
  `DispensingAdapter`) and the patient `/treatment` view shows the script +
  status + delivery tracking, plus a repeat-request entry. Closes **dispensing**
  on top of the P3 fast lane.
- **Key pattern:** decision and transmission stay SEPARATE functions.
  `decideClinicianAction` is unchanged — it is the clinical decision and still
  stops at `rx_issued`. The new `dispenseIssuedScript`
  (`src/lib/dispensing/dispense.ts`) is the ONE place a script is transmitted to
  the pharmacy: it advances `rx_issued -> dispensing` (the journey machine bars
  this from any other state, so a script cannot dispense without first being
  clinician-issued). The `/api/clinician/decide` route COMPOSES them: on approve
  it calls `dispenseIssuedScript` after the decision. The same dispensing
  function serves P6's full lane later (consult_done -> rx_issued -> dispensing).
- **Mock status walk:** `MockDispensing.advanceStatus` (a mock-ONLY affordance,
  NOT on the adapter interface — the real CloudRx pushes its own status) steps
  submitted -> dispatched -> delivered and appends tracking events. The dev route
  `/api/dev/advance-dispense` drives it; when it reaches delivered it advances
  `dispensing -> delivered`. Surfaced as a clearly-fenced dev control on
  `/treatment` (hidden once delivered or for any non-mock impl).
- **Repeat:** `lodgeRepeatRequest` writes a `createRepeatRequest` to the core and
  inserts a fresh pending fast-lane `queue_item` (via the shared
  `insertFastQueueItem`, also now used by intake) so the repeat ENTERS the
  clinician queue. The hard line holds — a repeat issues no script on its own; a
  clinician still decides. The re-approval loop + membership / no-charge tiering
  are P5 (the repeat enters the queue now; its decision wiring lands with money).
- **Boundary:** the new app-DB `dispense_ref` table (P4 migration) is POINTERS +
  coarse status ONLY (`rx_ref`, `dispense_id`, `submitted|dispatched|delivered`).
  The script + the pharmacy record live behind the `DispensingAdapter` (the
  `mock_dispense` stand-in this phase), never in the app DB. A denylist test
  asserts the column set never grows to clinical detail. No new journey state
  (the machine already carried `rx_issued -> dispensing -> delivered`).
- **Proven on the live URL:** approve -> the script reaches the mock pharmacy and
  the patient sits at `dispensing` with status **Sent to the pharmacy**; advancing
  the mock -> `dispatched` -> `delivered` reflects on `/treatment` (tracking trail
  + `dispensing -> delivered`); a lodged repeat appears as a new pending item in
  the clinician queue. `npm test`: 48 passed.

## P5 done (payment + membership + repeat tiering — money closes)

- **Added:** the money surface. A one-off consult fee (Stripe Checkout,
  mode=payment, ~£100) and a recurring membership (Stripe Billing,
  mode=subscription, ~£18/mo), the customer portal, and the first-vs-repeat
  tiering rule, all behind a new `PaymentsAdapter` (mocked now). Closes **money**
  on top of the P4 dispensing loop.
- **Key pattern (the second external integration, mirrors Stripe Identity
  exactly):** `PaymentsAdapter` interface + `MockPayments` (default, dev-walkable
  via `mock_payment_session` + a `/account/billing/mock` checkout page) +
  `StripePayments` (real, Stripe REST via `fetch`, NO Node SDK). Factory
  `getPayments()` picks the impl from `PAYMENTS_IMPL` (default `mock`); never
  branch on the impl elsewhere (the mock-confirm + mock-portal-cancel routes do an
  `instanceof MockPayments` check to complete the mock flow server-side, a
  mock-only test affordance like the identity one). The webhook
  `/api/webhooks/stripe-billing` reuses the existing `verifyStripeWebhook` HMAC
  check with its own `STRIPE_BILLING_WEBHOOK_SECRET`; the `/account/billing/complete`
  return-page poll (`finaliseLatestPending`) is the idempotent fallback, exactly
  as the identity webhook + verify/complete poll pair.
- **The tiering rule, in code:** orchestration lives in `src/lib/payments/billing.ts`.
  FIRST script = consult-priced: `hasPaidConsult(accountId)` is the gate the
  full-lane booking (P6) will consult; P5 builds + proves it. REPEATS =
  membership-covered: `lodgeRepeatRequest` now requires `isActiveMember` (a member
  rides free into the queue; a non-member is gated to subscribe). Money only
  GATES — paying never issues a script (a clinician still decides); decision and
  payment stay separate, like decision and dispensing in P4.
- **Journey machine untouched (spec-exact, no new states, no cycles):** membership
  reaches `active_member` via the existing `delivered -> active_member` transition
  (`advanceToActiveMemberIfEligible`, guarded + idempotent like
  `finaliseVerification`). The `membership` table is the authoritative billing
  status (`inactive | active | canceled`); a portal cancel flips it to `canceled`
  (the journey is NOT rolled back — `active_member` is terminal — but `isActiveMember`
  goes false, so a cancelled member loses the no-charge repeat).
- **Boundary (hard line):** the app-DB `membership` table (P5 migration) + the
  reused `payment_ref` (P0) hold POINTERS + coarse status ONLY
  (`provider_customer_ref`, `provider_subscription_ref`, `status`). NO card data,
  NO PII; the customer + payment method live with the provider (Stripe). A denylist
  test asserts the `membership` column set never grows to card/PII detail (mirrors
  the P2 intake_ref / P4 dispense_ref denylists).
- **Proven on the live URL:** consult fee paid -> gate flips (`Consultation fee
  paid`); subscribe -> membership active + journey `delivered -> active_member`;
  member repeat -> enters the clinician queue as a fresh pending fast-lane item,
  no new consult charge; non-member repeat -> gated; portal cancel -> membership
  `canceled`, member repeat re-gated. `npm test`: 55 passed.
- **Deferred (NOT built, same as P4 deferred the loop):** the full repeat
  re-dispense CYCLE (clinician re-approves a repeat -> re-issue -> re-dispense)
  needs non-spec journey cycles, so it is out of scope; P5 proves the repeat
  ENTERS the queue with no charge (the P5 success test), nothing more.

## Verifying

Success = the functional OUTCOME on the deployed URL, not "I made an edit" and
not a localhost check. Run `npm test` and exercise the flow on the preview URL.
