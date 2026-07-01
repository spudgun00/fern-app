# CLAUDE.md

Guidance for Claude Code working in this repo (the Fern patient zone app).

## What this is

The authenticated patient + clinician app, a **separate repo and deployment**
from the static marketing site at `fern.care`. Auth, secrets, and per-user data
live only here. Authoritative spec: `docs/fern-patient-zone-build-spec.md` — read
it before building. Build is phased (P0…P7); **build one phase, prove its success
test on the deployed URL, then stop**. Do not build ahead of a passing test.

On top of P0–P6 there is now a **demo-polish track (D1–D7)**, specced in
`docs/fern-demo-build-spec.md`: turn the proven-but-unstyled app into a complete,
self-walkable DEMO on dummy data (design system, demo personas, test-mode real
services, transactional email, sitewide demo banner + P7 stubs) while the
regulated core stays MOCK. Same cadence. The marketing design source is the
separate `spudgun00/fern` repo, cloned as a sibling at `../fern-marketing`.

Status: **P6 built and proven** (full lane: booking + patient consult room +
clinician consult console — **full lane closes; the initiation path is operable**),
deployed at https://fern-app.jimgill.workers.dev. P0 (foundation + adapter spine +
mocks), P1 (account + ID verification), P2 (two-lane intake + deterministic
routing), P3 (clinician console — fast lane closes), P4 (script to CloudRx +
patient dispensing status — dispensing closes) and P5 (payment + membership +
repeat tiering — money closes) all done and proven. Success test A (`npm test`,
**71 passed**) and B pass. P6's test proved on the deployed URL: a full-lane
(initiation) intake routes to the assessed lane; paying the consult fee gates the
booking; booking a slot (mock Cal.com) advances `intake_submitted -> consult_booked`
and mints a video room; the patient and the clinician console resolve the SAME
video room URL; the clinician issues a (mock) script from the consult and the
patient advances `consult_done -> rx_issued -> dispensing` (treatment shows the
script "Sent to the pharmacy"); the decided consult drops out of the consult queue.
P1's Test C (real Stripe Identity test-mode path), P5's real Stripe Checkout/Billing
path, and P6's real Cal.com + Daily paths are all wired-but-unclosed (need the test
secrets set, see below). P7 not started.

**Demo track status: D5 built, proof pending** (D1 design foundation + app shell;
D2 patient surfaces styled; D3 clinician surfaces styled + onboarding tail folded
into the Fern shell; D4 demo personas + the self-walkable reviewer panel at `/demo`
+ the demo-data cleanup; **D5 transactional email** — the new `EmailAdapter` +
`MockEmail`/`ResendEmail` behind `getEmail()`/`EMAIL_IMPL`, Fern-styled welcome /
consult-booked / script-shipped emails composed as non-clinical side effects at the
journey events, default `mock` logs server-side for the zero-keys walk). The
**provider decision** (taken at the top of D5): Resend, sending from a VERIFIED
SUBDOMAIN `noreply@mail.fern.care` — a subdomain, not the apex, so the app's
transactional email DNS stays isolated from the live Brevo waitlist mail on the
`fern.care` apex (no SPF collision). `npm test`: **103 passed** (94 -> 103; +9 D5
adapter/template/never-gates tests). D5's live-URL proof (real emails to a test
inbox with `EMAIL_IMPL=resend`) is pending the `mail.fern.care` Resend
verification. **D6 is PARKED awaiting James's Stripe setup** (code verified ready,
flags NOT flipped — see the "D6 PARKED" note below for the exact resume state). D7
not started. The corrected Fern design system is
vendored into `src/styles/tokens/` (a faithful copy of the marketing tokens with
the cream ground corrected from the stale `#F4EFE5` to `#F8F7F0`; a test locks
this). Shared shell in `src/layouts/Layout.astro` + `src/components/`
(`Nav` variants public/onboarding/patient/clinician, `Footer`, `Wordmark`,
`Coming`). The demo banner is injected sitewide by the middleware
(`src/lib/demo-banner.ts`) so it shows on EVERY route, including surfaces not yet
on the Layout (the dev harness, the mock provider stand-ins not in a build list)
until a later phase brings them across; the patient (D2) and clinician (D3)
surfaces now render the banner above their own Fern shell.
Proved on the deployed URL: the entry/auth/account/about surfaces render as Fern
(corrected cream, navy Fraunces, Inter, the marketing card/band/button rules); the
banner shows on every route; the Dashboard/Treatment/Messages/Documents stubs
appear in the patient nav and the stub pages render a styled "coming" state.

**D2 (patient surfaces styled)** restyles the whole patient happy path onto the D1
shell + primitives — presentation only, no journey/routing/gate/logic change (the
frontmatter of each page is untouched bar adding the `Layout` import): `intake`
(the core questionnaire — styled fieldset cards + the routing outcome as a
next-step card with a "why this next step" panel; describe-never-diagnose
preserved), `consult` (pay-gate / book / room / refusal branches), `consult/book/mock`
(slot picker), `consult/book/complete`, `consult/room/mock` (the video stand-in,
now a navy stage), `treatment` (script + dispensing + a tracking timeline + repeat
+ the fenced dev advance-control), and `account/billing` (+ `billing/complete`,
`billing/mock` checkout, `billing/mock-portal`). The mock provider stand-ins
(checkout / scheduler / room / portal) wear a "Demo stand-in" pill; the dev
affordances stay clearly fenced. The brand's periwinkle is the confirmation
surface (paid / booked / approved / issued pills + `notice-info`); a `notice-soft`
neutral was added to `app.css` for in-progress holds. No new palette, no warm
leftovers. Proved on the deployed URL with a full FULL-LANE walk: intake
(initiation) -> routes to the full lane -> pay the consult fee (mock checkout) ->
book a slot (mock) -> `consult_booked` + minted room -> join the styled room ->
a clinician issues at the consult -> patient `/treatment` shows the script "Sent
to the pharmacy"; every screen is Fern, the journey advanced exactly as before.
`npm test`: **80 passed** (D2 is presentation-only; its proof is the live-URL
walk, not new tests).

**D3 (clinician surfaces styled + onboarding tail)** restyles the clinician console
onto the D1 shell and folds the last raw onboarding pages into Fern — presentation
only, the decision logic untouched (each page's frontmatter unchanged bar adding
the `Layout` import): `clinician/index` (the fast-lane review queue, now styled
queue cards with condition + ref + routing-reason pills), `clinician/consults` (the
assessed-lane consult queue, styled cards + a "queue empty" state), `clinician/intake/[id]`
(intake detail as a meta card + routing pills + a styled clinical-picture
definition list + the **Approve + issue | Escalate | Refuse** action bar),
`clinician/consult/[id]` (consult detail + a periwinkle "room ready" video-room
card with the join button + the **Issue | Refuse** action bar), and the onboarding
tail `account/verify/mock` (the ID-check "Demo stand-in", mirroring the
billing/mock pattern) + `account/verify/complete` (the verified / in-progress
result card). Refuse wears a warn-tinted ghost button; the clinician nav variant
carries the "Clinician console" tag. Proved on the deployed URL: a clinician views
the styled review queue, opens an intake, and **Approves** -> the patient advances
`rx_issued -> dispensing` ("Sent to the pharmacy" on `/treatment`) and the item
drops out of the queue; an **Escalate** moves the same intake into the full lane,
the patient pays (mock checkout) + books (mock slot) -> `consult_booked` + a minted
room, and the patient `/consult` and the clinician `clinician/consult/[id]` resolve
the SAME room URL; the clinician **Issue** advances `consult_done -> rx_issued ->
dispensing` and the decided consult drops out of the consult queue; the onboarding
tail (`verify/mock`, `verify/complete`) renders in full Fern. Every clinician +
onboarding screen is now Fern; with D2 the entire walkable surface (patient +
clinician + onboarding tail) is styled, decision logic untouched. `npm test`:
**80 passed** (D3 is presentation-only; its proof is the live-URL walk). D4–D7 not
started.

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
  `IdentityAdapter`, `PaymentsAdapter`, `BookingAdapter`, `VideoAdapter`,
  `MockCore` (Supabase `mock_*` tables), `MockCoreB` (in-memory), `MockDispensing`,
  `MockIdentity` (mock provider, `mock_identity_*`), `MockPayments` (mock provider,
  `mock_payment_session`), `MockBooking` (mock provider, `mock_booking_session`),
  `MockVideo` (stateless — the join URL derives from the room ref, no table),
  `StripeIdentity` / `StripePayments` / `CalcomBooking` / `DailyVideo` (real, REST
  via fetch, no Node SDK).
- Factory: `getClinicalCore()` / `getDispensing()` / `getIdentity()` /
  `getPayments()` / `getBooking()` / `getVideo()` pick the impl from `CORE_IMPL` /
  `DISPENSING_IMPL` / `IDENTITY_IMPL` / `PAYMENTS_IMPL` / `BOOKING_IMPL` /
  `VIDEO_IMPL` (default `mock`). Never branch on the impl anywhere else (the dev
  harness + the mock-confirm / mock-portal-cancel routes do an `instanceof Mock*`
  check to complete the mock flow server-side; that is a mock-only test affordance,
  not business logic).
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

**To activate the Cal.com booking path (P6):**
1. Create a free Cal.com account + a consult event type; `wrangler secret put
   CALCOM_API_KEY` (a Cal.com API key), `CALCOM_EVENT_TYPE_ID` (the consult event
   type id) and `CALCOM_BOOKING_URL` (the public booking page, e.g.
   `https://cal.com/fern/consult`).
2. Add a Cal.com webhook subscribed to `BOOKING_CREATED` (+ `BOOKING_RESCHEDULED`)
   pointing at `https://fern-app.jimgill.workers.dev/api/webhooks/calcom-booking`;
   copy its signing secret into `wrangler secret put CALCOM_WEBHOOK_SECRET` (HMAC
   over the raw body, header `X-Cal-Signature-256`). The booking page carries our
   `metadata[fernRef]` correlation pointer so the webhook maps back to an account.
3. Set `BOOKING_IMPL` to `calcom` in `wrangler.jsonc` `vars`, `npm run deploy`,
   then walk `/consult` -> book a slot. The webhook advances the journey to
   `consult_booked`; the `/consult/book/complete` poll is the idempotent fallback.
Leave `BOOKING_IMPL=mock` to keep the no-keys mock booking walk working.

**To activate the Daily video path (P6):** `wrangler secret put DAILY_API_KEY`
(a Daily API key) and `DAILY_DOMAIN` (your `*.daily.co` subdomain). Set
`VIDEO_IMPL` to `daily` in `wrangler.jsonc` `vars`, `npm run deploy`. Rooms are
created per consult (idempotent by name) when a booking is finalised; both sides
join `https://<DAILY_DOMAIN>.daily.co/<room>`. Leave `VIDEO_IMPL=mock` to keep the
no-keys in-app mock room (`/consult/room/mock`) working.

**To activate the Resend email path (D5):**
1. Create a free Resend account. **Verify a SUBDOMAIN of fern.care, not the apex.**
   The apex (`fern.care`) already sends the marketing waitlist email via Brevo;
   verifying the app's transactional email on the apex too risks an SPF collision
   between two senders. Verify `mail.fern.care` (add Resend's MX/TXT/DKIM records
   for that subdomain only) so the app's email DNS stays fully separate from the
   live Brevo apex mail. `wrangler secret put RESEND_API_KEY` (a `re_…` key);
   server-only, never `PUBLIC_`. `EMAIL_FROM` defaults to
   `Fern <noreply@mail.fern.care>`; override it (a non-secret `var`) only to change
   the sender. Until the subdomain is verified, Resend sends only to your own
   account address — fine for a first proof.
2. Set `EMAIL_IMPL` to `resend` in `wrangler.jsonc` `vars`, `npm run deploy`, then
   sign up (welcome), book a consult (consult booked) and have a clinician issue
   (script shipped). Each send is a non-clinical side effect: it fires exactly once
   at the journey event, carries status + next step only (no Article 9), and a
   failed send logs without blocking the flow.
Leave `EMAIL_IMPL=mock` to keep the no-keys demo whole — the mock logs the composed
email server-side (visible in `wrangler tail`) and the walk is unaffected.

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

- **Added:** the money surface. The consult fee (~£100, Stripe Checkout) gates the
  full-lane booking + first script; subscribing to membership (~£18/mo, Stripe
  Billing) activates `active_member`; a member's repeat is no-charge but still
  ENTERS the clinician queue (a clinician decides); cancelling in the portal pulls
  the benefit. Closes **money** on the P4 dispensing loop.
- **Key pattern (mirrors the Stripe Identity integration exactly):**
  `PaymentsAdapter` + `MockPayments` / `StripePayments` behind `getPayments()` /
  `PAYMENTS_IMPL` — Stripe REST via `fetch` (no Node SDK), an HMAC-verified webhook
  (`/api/webhooks/stripe-billing`, own secret) with the `/account/billing/complete`
  poll as idempotent fallback.
- **Tiering rule (in `src/lib/payments/billing.ts`):** first script consult-priced
  (`hasPaidConsult` gate); member repeats no-charge (`lodgeRepeatRequest` requires
  `isActiveMember`); non-member / cancelled repeats gated. No path issues a script
  — money only gates, a clinician still decides.
- **Lines held:** journey machine untouched — `active_member` via the existing
  `delivered ->` transition, no new states/cycles; `decideClinicianAction`
  untouched (fast lane still closed); `membership` + reused `payment_ref` hold
  POINTERS + coarse status only, no card data / PII (denylist test, like
  intake_ref / dispense_ref). `npm test`: 55 passed; proven on the live URL.
- **Deferred (as P4 deferred its loop):** the full repeat-and-re-dispense cycle
  needs non-spec journey cycles; P5 only requires the repeat to enter the queue.

## P6 built, proof pending (full lane: booking + consult room + consult console — full lane closes)

- **Added:** the assessed / initiation lane — the clinically-primary first-script
  path. A full-lane (or escalated) patient pays the consult fee (P5 gate), books a
  slot (Cal.com, mocked behind `BookingAdapter`), joins a video room (Daily, mocked
  behind `VideoAdapter`), and a clinician takes the SAME decision as P3 at the
  consult. Closes the **full lane** end to end (intake -> book -> consult ->
  clinician decision -> script -> dispense).
- **Two new external integrations, same drill as Stripe Identity/Payments:**
  `BookingAdapter` + `MockBooking`/`CalcomBooking` behind `getBooking()`/
  `BOOKING_IMPL`; `VideoAdapter` + `MockVideo`/`DailyVideo` behind `getVideo()`/
  `VIDEO_IMPL`. REST via `fetch` (no SDK), an HMAC-verified Cal.com webhook
  (`/api/webhooks/calcom-booking`, `X-Cal-Signature-256`) with the
  `/consult/book/complete` poll as idempotent fallback. `MockVideo` is stateless
  (the join URL derives from the room ref).
- **Booking orchestration** (`src/lib/consult/booking.ts`): `startConsultBooking`
  is gated on `hasPaidConsult` (P5 tiering — the assessed first script follows a
  paid consult) and a bookable state; `finaliseBooking` creates the video room +
  advances `intake_submitted`/`escalated -> consult_booked` (idempotent with the
  webhook).
- **Key pattern (mirrors P3 exactly):** the full-lane decision lives in ONE
  function, `decideConsultAction` (`src/lib/clinician/consult.ts`), the parallel of
  `decideClinicianAction`. `rx_issued` is reachable ONLY through a clinician
  **Issue** action (`issuePrescription` with `decisionState: 'consult_done'`, called
  from that branch alone; the journey machine independently bars `rx_issued` from
  any non-decision state). The `/api/clinician/consult-decide` route COMPOSES it
  with `dispenseIssuedScript` on issue, exactly as the fast lane composes them.
- **Action bar:** **Issue script | Refuse + signpost.** Escalate is omitted —
  the assessed lane IS the fast lane's escalation target, so there is nowhere
  further to escalate to; the hard line ("a clinician can always refuse or
  escalate") is honoured by Refuse always being available.
- **Machine change (minimal, hard line intact):** added ONE transition,
  `consult_done -> refused`, so the clinician can refuse after a consult.
  `RX_ISSUED_PREDECESSORS` stays exactly `{approved, consult_done}` and `refused`
  stays terminal (proven by the journey test + a P6 machine test). No new journey
  state / enum value.
- **Boundary:** the app-DB `booking_ref` (P0 table, extended in P6) is POINTERS +
  scheduling/decision status ONLY (`provider_ref`, `slot_at`, `room_ref`,
  `decided_by`/`decided_at`/`note_ref`/`rx_ref`, `status` pending -> booked ->
  issued|refused). The consult rationale + script live in the core; the call lives
  with the video provider. A denylist test asserts the column set never grows to
  clinical detail / card data / PII.
- **Proven on the live URL:** an initiation intake routes to the full lane; the
  booking is gated on the paid consult fee; booking a slot (mock) advances ->
  `consult_booked` and mints a video room; the patient `/consult` page and the
  clinician `/clinician/consult/[id]` console resolve the SAME room URL; the
  clinician Issue advances `consult_done -> rx_issued -> dispensing` and the
  script reaches the pharmacy ("Sent to the pharmacy" on `/treatment`); the
  decided consult drops out of `/clinician/consults`. The refuse path
  (`consult_done -> refused`) is proven by `test/p6-consult.test.ts`. `npm test`:
  71 passed.

### Known gaps before go-live (do NOT lose these)

These survive into later phases. None blocks the spine; (a) is the one that matters before go-live.

- **(a) Consult ATTENDANCE is not enforced, only booking is (touches the hard line).**
  `consult_booked -> consult_done` is auto-advanced INSIDE `decideConsultAction`
  as a side effect of Issue/Refuse, so a clinician can currently issue a script
  from a booked consult the patient never joined. The hard line says "the script
  follows a real consult" but the code only proves *booked*, not *attended*. With
  real Daily, gate `consult_done` on an attendance signal (a `meeting.ended` /
  participant-joined webhook) so "assessed" is proven, not asserted — and make
  "the consult took place" its own event, decoupled from the prescribing decision
  (the same decision-vs-dispensing separation the codebase already prizes).
- **(b) No DEFERRED outcome.** The full-lane bar is Issue | Refuse; Refuse is terminal
  and signposts the patient AWAY (GP / NHS 111). The common clinical middle ground
  ("I can't decide yet — needs bloods / a proper BP / GP records, come back") has
  nowhere to go: it wrongly collapses into Refuse. The right future addition is a
  *deferred / pending-investigation* outcome that KEEPS the patient in the journey
  (a new state + transition), NOT an "escalate" button (escalate has no target in
  the assessed lane) and NOT "refer out".
- **(c) Two edges.** `CalcomBooking.getBookingStatus` scans only the last 50 bookings
  by metadata `fernRef`; fine as the webhook fallback it is, but it will miss anything
  past that window, so do not lean on the poll at volume — the webhook stays
  authoritative. And the consult console reads the patient's LATEST intake_ref, which is the
  correct one today but is an assumption that breaks once a patient has more than
  one intake (e.g. fast-then-escalated, or a repeat). Tie the consult to a specific
  intake pointer when that becomes possible.

## D2 done (patient surfaces styled — the patient happy path turns Fern)

- **Added:** the whole patient happy path restyled onto the D1 shell + primitives
  (`Layout`, `Nav` patient variant, the `card`/`field`/`btn`/`pill`/`notice`
  primitives). The app's patient path stops looking like a harness and reads as
  Fern end to end.
- **Presentation only (the hard line for this phase):** every page's frontmatter
  is unchanged bar adding the `Layout` import — no change to intake routing, the
  consult pay-gate, journey transitions, or the `instanceof Mock*` mock-confirm
  affordances. The styling wraps the existing logic, it does not touch it.
- **Surfaces:** `intake` (the core questionnaire as styled fieldset cards; the
  routing outcome as a next-step card + a "why this next step" panel, with the
  describe-never-diagnose copy preserved), `consult` (pay-gate / book / room /
  refusal branches), `consult/book/mock` (slot picker), `consult/book/complete`,
  `consult/room/mock` (the video stand-in, now a navy stage), `treatment` (script
  + dispensing + a tracking timeline + repeat + the fenced dev advance-control),
  and `account/billing` (+ `billing/complete`, `billing/mock` checkout,
  `billing/mock-portal`).
- **Brand calls (held to the colors.css system):** periwinkle is a SURFACE never a
  button — it carries the confirmation states as pills + `notice-info` (paid /
  booked / approved / issued), not green; dispensing + lane status read as styled
  **pills**; the mock provider stand-ins (checkout / scheduler / room / portal)
  wear a **"Demo stand-in" pill** and the dev affordances stay clearly fenced. One
  `notice-soft` neutral was added to `app.css` for in-progress holds. No new
  palette, no warm-hardcoded leftovers.
- **Proven on the live URL (full-lane walk):** intake (initiation) -> routes to the
  full lane -> pay the consult fee (mock checkout) -> book a slot (mock) ->
  `consult_booked` + minted room -> join the styled room -> a clinician issues at
  the consult -> patient `/treatment` shows the script "Sent to the pharmacy";
  every screen is Fern and the journey advanced exactly as before. `npm test`:
  **80 passed** (D2 is presentation-only; its proof is the live-URL walk).

### Open gap before D3 (closed in D3)

- **The onboarding tail was still raw harness.** `account/verify/mock` and
  `account/verify/complete` were unstyled harness pages sitting just before the
  D2 path during onboarding. **Closed in D3:** both are now on the Fern shell
  (`verify/mock` as a "Demo stand-in", `verify/complete` as a result card). The
  whole walk, onboarding tail included, is now styled.

## D3 done (clinician surfaces styled + onboarding tail — the whole walk turns Fern)

- **Added:** the clinician console + the last raw onboarding pages restyled onto
  the D1 shell + primitives. With D2 the *entire* walkable surface (patient +
  clinician + onboarding tail) now reads as Fern.
- **Presentation only (the hard line for this phase):** `decideClinicianAction`
  and `decideConsultAction`, the journey machine, the role gates, and every
  data-fetch are unchanged — each page's frontmatter is untouched bar adding the
  `Layout` import. The clinician-gated `rx_issued` + the recorded reason/audit are
  presentation-wrapped, not altered.
- **Surfaces:** `clinician/index` (fast-lane review queue → styled cards: condition,
  account ref pill, routing-reason pills, oldest-first), `clinician/consults`
  (assessed-lane consult queue → styled cards + a "queue empty" state),
  `clinician/intake/[id]` (intake detail = meta card + routing pills + a
  clinical-picture definition list + the **Approve + issue script | Escalate to
  consult | Refuse + signpost** action bar), `clinician/consult/[id]` (consult
  detail + a periwinkle "room ready" video-room card with the join button + the
  **Issue script | Refuse + signpost** action bar), and the onboarding tail
  `account/verify/mock` (the ID-check "Demo stand-in") + `account/verify/complete`
  (verified / in-progress result card).
- **Brand calls (held to the colors.css system):** periwinkle is the confirmation
  surface (the "room ready" pill, the decided-state `notice-info`); booking/queue
  status reads as styled **pills**; Refuse is a **warn-tinted ghost** button (not a
  filled red); the clinician nav variant carries the mono "Clinician console" tag;
  the mock stand-ins keep the "Demo stand-in" pill. No new palette, no warm leftovers.
- **Proven on the live URL (both lanes):** **fast lane** — a clinician views the
  styled review queue, opens an intake, **Approves** → patient advances
  `rx_issued -> dispensing` ("Sent to the pharmacy" on `/treatment`) and the item
  drops out of the queue. **Full lane (via escalate)** — the same intake is
  **Escalated** → full lane; the patient pays (mock checkout) + books (mock slot)
  → `consult_booked` + a minted room; the patient `/consult` and the clinician
  `clinician/consult/[id]` resolve the **same** room URL; the clinician **Issue**
  advances `consult_done -> rx_issued -> dispensing` and the decided consult drops
  out of the consult queue. The onboarding tail renders in full Fern. `npm test`:
  **80 passed** (D3 is presentation-only; its proof is the live-URL walk). D4–D7
  not started.

## D4 done (demo personas + self-walkable path switcher + demo-data cleanup)

- **Added:** a purpose-built, fully-styled reviewer panel at `/demo` that turns the
  demo from "you drive it" into "a reviewer drives it themselves." It is separate
  from `/dev/harness` (the raw dev tool stays as-is): `/demo` is the clean front
  door to hand to a clinical lead. Reachable from `/about-this-demo` (which the
  sitewide banner links to on every route).
- **Six curated personas** (`src/lib/demo/personas.ts`, `PERSONAS`), each resetting
  the logged-in account and seeding dummy data through the SAME adapters + journey
  machine the app uses, landing the reviewer at the actionable point of one path:
  **fast-approve** (continuing -> fast lane -> clinician approve -> dispensed),
  **full-consult** (initiation -> full lane -> pay -> book -> room -> clinician
  issue -> dispensed), **red-flag** (unexplained bleeding -> stop + GP signpost,
  terminal), **escalate** (fast -> clinician escalate -> full lane), **refuse**
  (fast -> clinician refuse -> terminal signpost), **cancel** (active member ->
  portal cancel -> benefit pulled). Built on the existing scenario spine, not from
  scratch. The panel also carries a role switch (patient <-> clinician on the one
  account) and a "reset to a clean slate".
- **Key pattern:** `applyPersona()` = `resetAndSweep()` + `seedOnboarding()`
  (registered -> id_verified via the mock identity round-trip) + a per-persona seed
  (`seedIntake` through `submitIntake`, or `seedActiveMember`), then sets the
  landing role. Routes are thin: `/api/demo/persona` (apply, or `persona=reset`),
  `/api/demo/role` (flip role, return to a `/`-path), `/api/demo/purge` (fenced
  global purge).
- **HARD LINE held (proven by `test/d4-personas.test.ts`):** no persona seed reaches
  a prescribing state or issues a script — a persona drives the patient TO a
  clinician decision; the clinician action (or the fenced dev step) still takes it.
  `seedActiveMember` seeds a billing POSITION + an active membership pointer ONLY
  (it places the journey at `active_member` via the raw setter for a billing-only
  walk; it never calls `issuePrescription`, never mints an rx). The journey machine
  + `decideClinicianAction` / `decideConsultAction` are untouched.
- **Demo-data cleanup (folded into D4):** the demo touches ONLY the throwaway
  namespaced `mock_*` tables (enumerated in `MOCK_TABLES`) and the per-account
  app-DB pointer rows. `resetAndSweep(account)` runs on EVERY persona apply: it
  sweeps that account's `mock_*` clinical rows (by `core_patient_id` / via the
  `dispense_ref` -> `mock_dispense` pointers / by `account_id`) BEFORE clearing the
  app-DB pointers, then resets the journey — so no stale `mock_*` leaks into the
  next walk (a test proves a re-applied persona does not inherit the prior intake).
  `purgeAllDemoData()` wipes every `mock_*` row across all accounts for a fresh
  handover; the panel fences it (warn-tinted card, a `<details>` disclosure, a
  required confirm checkbox) and the route rejects a POST without `confirm=purge`.
  **By design this NEVER touches Supabase auth users** (James cleans those
  separately, supervised) — the same mock-only boundary the whole build holds.
- **Known wrinkle (not blocking, deliberately left in-track):** the clinician queue
  (`listPendingFastQueue`) and consult queue are GLOBAL — they list pending items
  across all accounts. On a DB with accumulated test/dev accounts the queues show
  many cards; the global purge clears `mock_*` but NOT the app-DB `queue_item` /
  `booking_ref` rows of abandoned accounts, so stale cards can persist (they read
  "unknown" once their `mock_*` intake is purged). This is **resolved by the
  supervised, manual auth-user + abandoned-account cleanup James runs out-of-band**
  (the same one-off that removes leftover Supabase auth users): after it, a reviewer
  on a clean handover sees only their own card. It is **deliberately NOT pruned by a
  demo-panel button or the persona reset** — doing so would reach app-DB rows of
  OTHER accounts, breaking the `mock_*`-only boundary this track holds (the demo
  surface touches only throwaway `mock_*` data + the current account's own pointers,
  never another account's app-DB state, never auth users). When driving a walk
  programmatically, target your own item by matching `account_id.slice(0,8)` (the
  `.qref` pill on each card).
- **Proven on the live URL** (a throwaway in-browser signup gives a session; signup
  bypasses email confirmation): from the styled `/demo` panel each of the six
  personas walks to its terminal state on the real Fern surfaces — fast-approve and
  full-consult both reach `/treatment` showing "issued by a clinician" + "Sent to
  the pharmacy"; red-flag shows the stop + GP signpost; escalate lands the patient
  at the full-lane consult pay-gate; refuse shows the terminal signpost; cancel
  flips membership to cancelled; reset returns a clean slate; the global purge runs
  (and is rejected without the confirm). `npm test`: **94 passed** (80 -> 94; +14
  D4 persona/cleanup/hard-line tests). D5-D7 not started.

## D5 built, proof pending (transactional email — the one missing realism piece)

- **Decision taken at the top of D5 (provider + domain):** **Resend**, sending
  from a **verified subdomain** `Fern <noreply@mail.fern.care>` — NOT the
  `fern.care` apex. The apex already sends the marketing waitlist email via Brevo;
  verifying the app's transactional email on a separate subdomain keeps the two
  senders' DNS apart and avoids an SPF collision, while reading just as clean to a
  recipient. Resend free tier (3,000/mo) is ample; until the subdomain is verified
  Resend sends only to your own account address (fine for a first proof).
- **Added (same drill as the other adapters):** `EmailAdapter` (`src/lib/adapters/
  email.ts`) + `MockEmail` (logs the composed message server-side + records it for
  tests; the zero-keys walk) / `ResendEmail` (REST via `fetch`, no SDK) behind
  `getEmail()` / `EMAIL_IMPL` (default `mock`). New env: `EMAIL_IMPL` (`vars`,
  default `mock`), `RESEND_API_KEY` (secret, required ONLY when `EMAIL_IMPL=resend`),
  `EMAIL_FROM` (non-secret, defaults to the `mail.fern.care` sender). Fern-styled
  templates in `src/lib/email/templates.ts` (navy header band + lime wordmark dot,
  cream ground, periwinkle status surface, the navy next-step button; British
  English, no emoji; email-safe inline HTML, no webfont dependency).
- **Three sends, hooked at the existing journey events (compose, do not entangle):**
  **welcome** at `api/auth/signup.ts` (account created), **consult booked** inside
  `finaliseBooking` right after `-> consult_booked`, **script shipped** inside
  `dispenseIssuedScript` right after `rx_issued -> dispensing`. The notify layer
  (`src/lib/email/notify.ts`) resolves the recipient (account -> auth user email),
  composes the template, and SWALLOWS any failure. The booking + dispense functions
  take an OPTIONAL `notify` param (omitted by tests + seeding, so neither emails);
  the send fires EXACTLY ONCE because it sits inside the one-time transition branch
  (a re-poll / webhook re-fire finds the patient already advanced and skips).
- **HARD LINE held (proven by `test/d5-email.test.ts`, 9 tests):** email is a
  NON-CLINICAL side effect — **no journey transition depends on a send, and a failed
  send never blocks a flow** (a throwing adapter still advances `rx_issued ->
  dispensing`; a throwing send through the notify helper resolves normally). Bodies
  carry **status + next step only, no Article 9** — a denylist test asserts no
  clinical term (medication names, symptoms, dose, "menopause"/"HRT", red-flag
  terms) appears in any template; the welcome copy was de-conditioned to
  "your care" since an inbox is less protected than an authenticated screen. The
  journey machine + `decideClinicianAction`/`decideConsultAction` are untouched.
- **Proof pending (the live-URL walk):** with `EMAIL_IMPL=resend` + `RESEND_API_KEY`
  set and `mail.fern.care` verified in Resend, sign-up / booking / dispatch each
  deliver the real Fern-styled email to a test inbox; with `EMAIL_IMPL=mock` the
  same steps log the composed email server-side (`wrangler tail`) and the flow is
  unaffected. The mock path is built, proven by tests, and deployable now; the
  real-send proof needs the one-time Resend subdomain verification (see the
  activation block above). D6-D7 not started.

## D6 PARKED — awaiting James's Stripe setup (resume cleanly from here)

D6 (Stripe Identity + Checkout/Billing, test mode) is **green-lit but parked** so the
build can continue. No code or flags changed; the working tree is clean of D6 wiring.
Exact state to resume from:

- **Code paths all verified present:** `src/lib/adapters/stripe-identity.ts` +
  `stripe-payments.ts`, the two webhook routes, both `/complete` polls
  (`account/verify/complete.astro`, `account/billing/complete.astro`). `env.ts` FAILS
  LOUD on a missing secret when `*_IMPL=stripe` (throws `Missing required env var: …`),
  so a premature flip 500s the deploy rather than silently mocking — do not flip until
  the secrets below are set. `npm test`: **103 passed** (green baseline).
- **Already set as live Worker secrets (from the P1 Identity proof):**
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. The Identity half is therefore
  secret-ready; only the flag-flip + a dashboard check of the identity webhook remain.
- **Still needed from James (the Payments half), in Stripe TEST mode:**
  1. Two test Prices — a one-off ~£100 consult and a recurring ~£18/mo membership.
  2. The billing webhook endpoint (route + events below) + the customer portal enabled.
  3. `wrangler secret put` for the three secrets: `STRIPE_PRICE_CONSULT`,
     `STRIPE_PRICE_MEMBERSHIP`, `STRIPE_BILLING_WEBHOOK_SECRET`.
- **The flip happens ONLY after those three land:** set BOTH `IDENTITY_IMPL=stripe`
  and `PAYMENTS_IMPL=stripe` together in `wrangler.jsonc` `vars`, then `npm run deploy`
  (never a bare `wrangler deploy` — the adapter compiles `wrangler.jsonc` at build
  time). Then the live-URL proof (test-mode ID check -> `id_verified`; consult Checkout
  gates the booking; membership -> `active_member`; portal cancel -> benefit pulled).

**Exact webhook wiring to tick in the Stripe dashboard:**

- **Identity webhook** (already configured in P1 — confirm it still exists):
  endpoint `https://fern-app.jimgill.workers.dev/api/webhooks/stripe-identity`,
  events `identity.verification_session.*` (handler matches any
  `identity.verification_session.` prefix). Signing secret -> `STRIPE_WEBHOOK_SECRET`
  (already set). If the account/endpoint was rebuilt, re-add it and re-put the secret.
- **Billing webhook** (new for D6): endpoint
  `https://fern-app.jimgill.workers.dev/api/webhooks/stripe-billing`. The handler
  (`src/pages/api/webhooks/stripe-billing.ts`) acts on EXACTLY these three event types,
  so tick exactly these:
  - `checkout.session.completed` (marks the payment paid; on `metadata.kind=membership`
    upserts the membership + advances to `active_member`)
  - `customer.subscription.updated` (acts only when the new `status` is `canceled`)
  - `customer.subscription.deleted` (portal cancel -> `finaliseMembershipCancel`)
  Signing secret -> `STRIPE_BILLING_WEBHOOK_SECRET` (distinct from the identity one).
  This route is CSRF-exempt (JSON POST); its auth is the HMAC signature check.

### D6 PROVEN on the live URL (2026-06-30), flags then returned to mock

D6 was flipped (`IDENTITY_IMPL=stripe` + `PAYMENTS_IMPL=stripe`), proven end to end in
Stripe test mode, then flipped BACK to `mock` (the deployed demo stays keyless/reviewer-safe;
the real path is proven-but-off). All four outcomes verified in the app DB: test-mode ID check
-> `id_pending -> id_verified` (verified webhook); consult Checkout `4242` -> `payment_ref=paid`
and the booking gate opened; membership subscribe -> `membership` row `active` with real
`cus_`/`sub_` refs; immediate cancel -> `active -> canceled` via `customer.subscription.deleted`.

- **FINDING — portal cancel policy (decide before real launch):** the Stripe customer portal
  defaults to **cancel at period end** (`cancel_at_period_end=true`), which fires
  `customer.subscription.updated` with `status` STILL `active` — NOT `deleted`. The
  `stripe-billing` handler is correct to pull the benefit only on an ACTUAL cancellation
  (`deleted`, or `updated` with `status==='canceled'`), so a period-end cancel leaves the
  membership active until the period actually ends (proven: the portal cancel did not pull the
  benefit; an immediate dashboard cancel did). Before real launch: (1) decide cancel-immediately
  vs period-end policy and configure the portal to match; (2) for the period-end case, consider
  recording a **'pending cancellation'** state (active-but-ending) so the UI can show it, rather
  than silently staying `active` until `deleted` fires.

## Before real launch — external config checklist (findings from the D5-D7 live proofs)

These are PROVIDER-SIDE / config items surfaced while proving the real services in test mode.
None is a code bug; all survive to go-live and must be settled before real care. The app code
+ adapter wiring + journey machine are proven correct against them.

1. **Stripe portal cancel policy (D6).** The Stripe customer portal defaults to **cancel at
   period end** (`cancel_at_period_end=true`), which fires `customer.subscription.updated` with
   `status` still `active`, NOT `deleted`. The `stripe-billing` handler correctly pulls the
   membership benefit only on an ACTUAL cancellation (`deleted`, or `updated` with
   `status==='canceled'`), so a period-end cancel leaves membership `active` until the period
   ends (an immediate dashboard cancel pulls it at once — both proven). BEFORE LAUNCH: decide
   cancel-immediately vs period-end, configure the portal to match, and for the period-end case
   consider a **'pending cancellation'** state (active-but-ending) so the UI can show it. (Fuller
   detail in the D6 PROVEN note above.)
2. **`DAILY_DOMAIN` must be the SUBDOMAIN only (D7).** The DailyVideo adapter builds the join URL
   as `https://${DAILY_DOMAIN}.daily.co/${room}` (`daily-video.ts` `joinUrl`), so `DAILY_DOMAIN`
   must be just the subdomain (e.g. `ferncare`), NOT the full domain. It had been set to the full
   `ferncare.daily.co`, producing a doubled `ferncare.daily.co.daily.co/...` URL that would not
   open. FIXED 2026-06-30 (`wrangler secret put DAILY_DOMAIN` = `ferncare`, redeployed). The join
   URL is computed at render time from `room_ref` + the secret, so the fix needs no re-booking.
   Keep this value as the bare subdomain at go-live.
3. **Daily account needs a payment method (D7).** Loading a real room URL returned Daily's
   **"Missing payment method — add a payment method to use Daily"** page. Room CREATION via the
   API succeeds, but rooms will not SERVE/join until a payment method is on the Daily account.
   This is account billing, not code. BEFORE LAUNCH (and before the live video proof): add a
   payment method in the Daily Dashboard (confirm it unlocks the intended free tier / card-to-
   verify rather than a paid plan). RESOLVED for the test account 2026-06-30 (free-tier card on
   file: 10,000 participant-min/mo, usage-based above, no fixed fee) — the room then opened. The
   real go-live Daily account will need the same.
4. **Private consult rooms + per-participant meeting tokens (D7) — IMPLEMENTED 2026-06-30.** Daily
   rooms are created `privacy: 'private'` (the correct model for a confidential consult), so the
   bare room URL is denied ("You are not allowed to join this meeting"). `DailyVideo` now mints a
   per-participant **meeting token** (`POST /meeting-tokens`, room-scoped) per render and appends
   `?t=<token>` to the join URL; both patient and clinician get their own token, and the room opens
   to Daily's prejoin UI (proven on the live URL with a real booking). This is the ONE place where
   the demo runs DIFFERENT code from a mock (public-vs-private is a real go-live difference), so it
   was done properly rather than as a public link-only room. Contained entirely in `daily-video.ts`
   (no interface/caller change; tests use `MockVideo`, unaffected; 103 pass). DEFERRED go-live
   enhancements (intentionally out of scope to keep the change contained): token `exp` tied to the
   appointment window; `is_owner: true` for the clinician (host controls: eject, recording, waiting
   room — needs the role passed into `getRoom`); `user_name` for the prejoin display.
5. **`RESEND_API_KEY` must be a live Worker secret before flipping `EMAIL_IMPL=resend` (D5).**
   `env.ts` fails loud (env.ts:145, `Missing required env var: RESEND_API_KEY`) when
   `EMAIL_IMPL=resend` and the key is absent, so a premature flip **500s the WHOLE app on every
   route** (not just email). During the D5 proof the key was believed-set but was NOT in
   `wrangler secret list` for `fern-app`, so the flip took the live demo down until it was
   restored to `mock`; it came back the moment `RESEND_API_KEY` was actually `wrangler secret
   put`. BEFORE flipping: confirm `RESEND_API_KEY` is in `wrangler secret list`. (`EMAIL_FROM` is
   optional — defaults to `Fern <noreply@mail.fern.care>`.) The mock default never has this risk.
6. **Email HTML quoted-printable escaping (D5) — minor, verify before go-live.** The DELIVERED
   mail (verified in Gmail) shows a stray replacement char in the non-rendered `<head>` viewport
   meta: `width=device-width` arrives as `width<U+FFFD>vice-width` (the `=de` got decoded as a QP
   hex byte), which means the HTML's literal `=` signs may not be quoted-printable-escaped on send
   (Resend/adapter). It is invisible (head only) and the three templates render perfectly in Gmail
   (navy band + lime dot, periwinkle status surface, navy button, no Article 9), and the button
   URLs carry no `=`. But a future link with a `?x=<hex>` query param could be corrupted, so check
   the send transfer-encoding before go-live. D5 PROVEN on the live URL 2026-06-30: all three sends
   (welcome/consult-booked/script-shipped) delivered from `noreply@mail.fern.care` to the test
   inbox (not spam), Fern HTML intact, no clinical content; flags then returned to `mock`.

## Weight roadmap P2 done (screening before prescribing — adapter + states + guard)

Source of truth: `../fern/docs/fern-weight-roadmap.md` (the weight programme). This
is that roadmap's **P2** (a separate axis from this repo's P0-P6 / D1-D7; named
`screening`, not `p2`, to avoid clashing with the existing P2 intake). Built +
proven by `npm test` locally (117 passed, 103 -> 117; +14). Not deployed — James
pushes/verifies, per the roadmap.

- **New adapter (same spine + `*_IMPL` pattern as the other eight):**
  `ScreeningAdapter` (`orderKit`, `getKitStatus`, `getResults`) in
  `src/lib/adapters/screening.ts` + `MockScreening` (Supabase `mock_screening`,
  with a mock-only `advanceKit` affordance mirroring `MockDispensing.advanceStatus`)
  behind `getScreening()` / `SCREENING_IMPL` (default `mock`, added to `env.ts`,
  `factory.ts`, `wrangler.jsonc`). The blood-test RESULTS (panel values) are
  Article 9 and live ONLY behind the adapter; the app DB holds a pointer + status.
- **New journey branch (additive, machine stays otherwise spec-exact):** three
  states `screening_kit_sent -> sample_received -> results_ready` inserted after
  `intake_submitted` (enum extended by migration `20260701000000_screening.sql`,
  applied to the remote dev DB). `intake_submitted` now also forks to
  `screening_kit_sent`; `results_ready` rejoins the SAME two decision entry points
  (`in_review_queue` / `consult_booked`) with bloods attached. The direct
  (non-screening) menopause forks are unchanged.
- **THE GUARD (`src/lib/screening/guard.ts`):** a SECOND, independent lock, distinct
  from the rx_issued hard line. For a screening-REQUIRED patient (one with a
  `screening_ref`), a PRESCRIBING decision — fast-lane `approve` or full-lane
  `issue` — is blocked (`ScreeningNotReadyError`) until `screening_ref.status ===
  'results_ready'`. Wired into both `decideClinicianAction` (approve branch) and
  `decideConsultAction` (issue branch, checked before any state change). Refuse /
  escalate are NEVER gated (a clinician can always decline or route on). No
  `screening_ref` (menopause fast lane) -> the guard is a no-op, so every existing
  flow is untouched (all 103 prior tests still green).
- **`RX_ISSUED_PREDECESSORS` is UNCHANGED** (still exactly `{approved,
  consult_done}`); the guard gates WHEN the decision may be taken, the machine gates
  what rx_issued's predecessors are. Both are asserted by tests.
- **Boundary:** app-DB `screening_ref` (migration) is POINTERS + coarse status ONLY
  (`kit_ref`, `status`); a denylist test asserts the column set never grows to
  marker values / ranges / clinical detail. `mock_screening` is the throwaway lab
  stand-in (fake clinical-shaped panel), deleted when the real UKAS lab is wired.
- **Orchestration** `src/lib/screening/order.ts`: `orderScreeningKit` /
  `receiveScreeningSample` / `attachScreeningResults` / `routeScreenedToReview`
  drive the branch (adapter call + legal journey advance + pointer status), landing
  at `in_review_queue` with a fast-lane `queue_item`. Nothing here auto-approves or
  auto-issues.
- **Tests** (`test/screening.test.ts`, 14): pure machine (branch legal + rx_issued
  hard line intact + screening states can't reach a decision/rx_issued), pure guard
  (null=allowed / pending=blocked / ready=allowed), adapter round-trip via the
  factory flag, the full orchestration walk, the guard blocking a REAL
  `decideClinicianAction` (approve blocked at kit_sent, refuse never gated, approve
  -> rx_issued once results_ready), and the `screening_ref` denylist.
- **Still to come (later weight phases):** P3 surfaces the bloods in the clinician
  review queue + consult console (decision visibly blocked until results present);
  P4 the GLP intake lane + pay-first checkout + automatic refund-on-refusal; P5
  unifies screening across menopause + weight. Real lab + real prescribing go live
  only on CQC + clinical lead + compliance sign-off.

## Weight roadmap P3 done (bloods in the clinician console + the Weight/BMI check)

Weight roadmap P3, on top of P2. Built + proven by `npm test` (126 passed, 117 ->
126; +9). Not deployed. Surfaces the screening to the clinician and makes the
guard's block VISIBLE in the console.

- **Console data loader** `src/lib/screening/review.ts` — `getScreeningReview(admin,
  screening, accountId)` returns `{ required, status, ready, blocked, panel }`. The
  panel is read from the ScreeningAdapter (Article 9, server-side for display,
  NEVER copied app-side) ONLY when `results_ready`; otherwise `blocked: true` and
  no panel. It MIRRORS the guard, so the console can never show an enabled
  prescribing action while `decideClinicianAction` / `decideConsultAction` would
  reject it.
- **Both clinician surfaces wired** (`clinician/intake/[id].astro` fast lane +
  `clinician/consult/[id].astro` full lane): a "Screening (bloods)" card renders the
  panel table when the results are in, or a "bloods pending — a prescribing decision
  is blocked" `notice-soft` when not; the primary action (Approve / Issue) is
  `disabled` when `review.blocked`, with an explanatory note. Escalate / Refuse stay
  enabled (a clinician can always decline / route on). Presentation only — the
  decision logic + the guard in the orchestration are unchanged.
- **Weight/BMI verification sub-step** `src/lib/intake/weight.ts` —
  `assessWeightEligibility({ bmi, hasRelatedCondition })` (BMI >= 30, or >= 27 with a
  related condition; pure, mirrors the public suitability copy) + `weightCheckFromAnswers`
  (pulls BMI out of the core intake answers, returns null for a menopause intake).
  BMI is Article 9: the VALUE lives in the core intake answers, the console shows a
  coarse eligibility pill as GUIDANCE — a clinician still decides. Surfaced as a
  "Weight / BMI check" card on both consoles when a BMI is present.
- **Tests** (`test/screening-review.test.ts`, 9): the pure eligibility check (>=30,
  27+with-condition, below-threshold, invalid), the console helper (null for no
  BMI), and `getScreeningReview` across the three states (none -> not required;
  pending -> blocked + no panel; ready -> not blocked + panel surfaced). `astro
  build` confirms both console pages compile.
- **Still to come:** P4 (GLP intake lane / contraindication screen + pay-first
  checkout + automatic refund-on-refusal), P5 (unify screening across menopause +
  weight). The BMI CAPTURE form (patient side) lands with the P4 GLP intake lane;
  P3 delivers the verification LOGIC + the console surfacing.

## Weight roadmap P4 done (GLP intake lane + pay-first + automatic refund-on-refusal)

Weight roadmap P4, on P2/P3. Built + proven by `npm test` (135 passed, 126 -> 135;
+9). Not deployed. The pay-first money model, made safe by an automatic refund.

- **GLP intake lane — the contraindication screen** `src/lib/intake/weight-routing.ts`:
  `routeWeightIntake(answers)` (pure, the weight parallel of `routeIntake`). Absolute
  contraindications (pregnancy / planning / breastfeeding / eating-disorder history /
  medullary thyroid cancer or MEN2 / pancreatitis) -> `stop` + a GP signpost. BMI is
  GUIDANCE not a gate (an out-of-range BMI still proceeds; a clinician decides after
  screening). `src/lib/weight/submit.ts` `submitWeightIntake` orchestrates it: writes
  the answers (incl. BMI, Article 9) to the CORE, advances the journey, records the
  app-DB pointer + outcome, and on `proceed` orders the screening kit
  (`intake_submitted -> screening_kit_sent`). Nothing here prescribes.
- **Pay-first + AUTOMATIC refund-on-refusal (the load-bearing piece):** weight is
  pay-at-checkout, BEFORE the clinician decides — only acceptable because the refund
  is instant and built in. A new `treatment` payment kind (enum migration
  `20260701000001_treatment_pay.sql`; reuses the `payment_ref` pointer table),
  `PaymentsAdapter.refund(sessionId)` (implemented in BOTH `MockPayments` — marks the
  provider session refunded — and `StripePayments` — resolves the session's
  payment_intent then POSTs a refund), and `refundOnRefusal` (`src/lib/weight/refund.ts`):
  on a paid `treatment` payment_ref it refunds the provider session + flips the pointer
  to `refunded`. **Composed into the refuse branch of BOTH `decideClinicianAction` and
  `decideConsultAction`** via an OPTIONAL `payments` param (mirrors D5's optional
  `notify`); the two clinician routes pass `getPayments(...)`, so every real refusal
  refunds. No `treatment` payment (menopause, or an unpaid weight patient) -> a no-op,
  so all prior flows/tests are untouched (126 still green). `hasPaidTreatment` gate
  added; `DecideResult`/`ConsultDecideResult` gain a `refunded` flag.
- **HARD LINE intact:** money only gates — paying issues no script (a clinician still
  decides), the rx_issued predecessors are unchanged, and the screening guard still
  applies (approve needs `results_ready`). Refund is on REFUSE only; approve keeps the
  charge and reaches rx_issued.
- **Tests** (`test/weight-lane.test.ts`, 9): the contraindication screen (clean ->
  proceed; each contraindication -> stop; out-of-range BMI still proceeds), the adapter
  refund, refund-on-refusal end to end (**pay -> refuse -> auto-refund asserted**;
  **pay -> approve -> rx_issued, charge kept**; no-op when nothing paid), and
  `submitWeightIntake` (proceed -> kit ordered; contraindication -> stop, no kit).
- **Still to come:** P5 unifies screening across menopause + weight (the shared
  "Midlife Health Screen"). The patient-facing GLP intake + pay-first checkout PAGES
  are thin wrappers over `submitWeightIntake` + `startCheckout('treatment', ...)`;
  this phase delivers + proves the orchestration + the refund safety net.

## Weight roadmap P5 done (one screening, two front doors — the Midlife Health Screen)

Weight roadmap P5, on P2-P4. Built + proven by `npm test` (144 passed, 135 -> 144;
+9). Not deployed. Unifies screening across the weight + menopause front doors.

- **Shared subsystem config** `src/lib/screening/panel.ts`: `SHARED_PANEL`
  (lipids, HbA1c, liver, thyroid) — the single source both doors run; `fshIndicated`
  (the NICE NG23 rule: FSH ONLY for 40-45 with symptoms, or under-40 suspected POI;
  NOT in the over-45s, who NG23 diagnoses clinically); `midlifeScreenPanel` (shared
  panel + conditional FSH); and `MIDLIFE_SCREEN` framing copy.
- **One flow, two doors:** the menopause "Midlife Health Screen" is NOT a separate
  flow — `startMidlifeScreen` (`src/lib/screening/order.ts`) is `orderScreeningKit`
  under screen-framed copy. Both `submitWeightIntake` (weight) and `startMidlifeScreen`
  (menopause) order the SAME kit, walk the SAME branch (`screening_kit_sent ->
  sample_received -> results_ready`), and hit the SAME guard before a clinician
  decides. A test proves the menopause door reaches the identical branch state.
- **SCREEN-FRAMED, not a diagnosis (hard framing rule):** `MIDLIFE_SCREEN.disclaimer`
  states "a health screen, not a diagnosis"; a test asserts the framing makes NO
  claim to diagnose menopause (NICE NG23: over-45 is a clinical diagnosis, no bloods).
- **Patient page** `src/pages/screening.astro` (navVariant patient): the shared
  Midlife Health Screen — framing + the screen-not-diagnosis disclaimer + the shared
  panel + the patient's own screen status (via the same `getScreeningReview` the
  console uses). Compiles under `astro build`.
- **Tests** (`test/midlife-screen.test.ts`, 9): the FSH NICE rule across ages/contexts,
  the panel (shared always present, FSH conditional), the screen-not-diagnosis framing,
  and the menopause front door entering the identical screening branch.

### Weight roadmap status after P5 (this repo's CC phases)

The CC-owned weight phases are **P2-P5, all done + green (144 tests)**: screening
adapter + branch + guard (P2), bloods in the console + BMI check (P3), GLP intake
lane + pay-first + refund-on-refusal (P4), unified Midlife Health Screen (P5). Built
against mocks, committed locally, NOT pushed/deployed (James pushes + verifies on the
preview per the roadmap). The remaining roadmap items are NOT CC coding tasks: **P-pw**
(Cloudflare Access password gate — dashboard) and **P0** (Brevo DOI automation +
worker — dashboard/API), both James-owned. `weightLossRx` on the marketing site and
the real clinical core / lab / prescribing go live only on CQC + clinical lead +
compliance sign-off. Patient-facing PAGES for the weight GLP intake + pay-first
checkout are thin wrappers over the proven `submitWeightIntake` /
`startCheckout('treatment', ...)` orchestration and can be styled in a later demo pass.

## Verifying

Success = the functional OUTCOME on the deployed URL, not "I made an edit" and
not a localhost check. Run `npm test` and exercise the flow on the preview URL.
