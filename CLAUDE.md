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

**Demo track status: D2 built and proven** (D1 design foundation + app shell;
D2 patient surfaces styled). The corrected Fern design system is
vendored into `src/styles/tokens/` (a faithful copy of the marketing tokens with
the cream ground corrected from the stale `#F4EFE5` to `#F8F7F0`; a test locks
this). Shared shell in `src/layouts/Layout.astro` + `src/components/`
(`Nav` variants public/onboarding/patient/clinician, `Footer`, `Wordmark`,
`Coming`). The demo banner is injected sitewide by the middleware
(`src/lib/demo-banner.ts`) so it shows on EVERY route, including surfaces not yet
on the Layout (clinician console, dev harness) until D2/D3 bring them across.
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
walk, not new tests). D3–D7 not started.

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

### Open gap before D3 (do NOT lose this)

- **The onboarding tail is still raw harness.** `account/verify/mock` and
  `account/verify/complete` (and the verify start page's deeper states) are still
  unstyled harness pages — they sit just before the D2 path during onboarding, so
  a reviewer hits them. They were not in D1's proof set or D2's build list. Fold
  them into the Fern shell in D3 (alongside the clinician surfaces) so the whole
  walk, onboarding tail included, is styled.

## Verifying

Success = the functional OUTCOME on the deployed URL, not "I made an edit" and
not a localhost check. Run `npm test` and exercise the flow on the preview URL.
