# CLAUDE.md

Guidance for Claude Code working in this repo (the Fern patient zone app).

## What this is

The authenticated patient + clinician app, a **separate repo and deployment**
from the static marketing site at `fern.care`. Auth, secrets, and per-user data
live only here. Authoritative spec: `docs/fern-patient-zone-build-spec.md` — read
it before building. Build is phased (P0…P7); **build one phase, prove its success
test on the deployed URL, then stop**. Do not build ahead of a passing test.

Status: **P3 built** (clinician console: review queue + async approve + script
issue — **the fast lane closes**), deployed at https://fern-app.jimgill.workers.dev.
P0 (foundation + adapter spine + mocks), P1 (account + ID verification) and P2
(two-lane intake + deterministic routing) done. Success tests A (`npm test`, 43
passed) and B pass. P3's test proved on the deployed URL: a fast-lane intake
appears in the clinician queue; **approve** issues a (mock) script and advances
the patient to `rx_issued`; **escalate** moves the patient into the full lane
(`escalated`, lane `full`, awaiting P6 booking); **refuse** terminates at
`refused` with a recorded reason and a patient-facing signpost; and a patient
role attempting `/api/clinician/decide` is blocked (no path reaches `rx_issued`
without a clinician action). P1's Test C (real Stripe Identity test-mode path) is
still wired-but-unclosed (needs the Stripe test secrets set, see below). P4+ not
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
  `IdentityAdapter`, `MockCore` (Supabase `mock_*` tables), `MockCoreB`
  (in-memory), `MockDispensing`, `MockIdentity` (mock provider, `mock_identity_*`),
  `StripeIdentity` (real, Stripe REST via fetch, no Node SDK).
- Factory: `getClinicalCore()` / `getDispensing()` / `getIdentity()` pick the
  impl from `CORE_IMPL` / `DISPENSING_IMPL` / `IDENTITY_IMPL` (default `mock`).
  Never branch on the impl anywhere else (the dev harness + mock-confirm route
  do an `instanceof MockIdentity` check to complete the mock flow server-side;
  that is a mock-only test affordance, not business logic).
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

- **Added:** the clinician console (fast-lane review queue + the prescribing
  action) on top of the P2 spine. No new journey state, no new app-DB table.
- **Key pattern:** ALL clinician decisions go through ONE function,
  `decideClinicianAction` in `src/lib/clinician/decide.ts` — the hard line lives
  there, in code: it asserts a **clinician** actor (defence-in-depth beyond the
  route's role gate), a **pending fast-lane item at `in_review_queue`**, and a
  **recorded reason**; writes the rationale to the CORE (`createConsultNote`,
  Article 9 reasoning stays in the core); then **approve** -> `issuePrescription`
  + `in_review_queue -> approved -> rx_issued`; **escalate** -> `escalated`
  (lane `full`, awaiting P6 booking — escalate stops at `escalated`, the
  `escalated -> consult_booked` booking is P6); **refuse** -> `refused` (terminal)
  + patient-facing signpost. `issuePrescription` is called from the approve
  branch only.
- **Surfaces (role-gated):** `/clinician` queue (pending fast-lane items, oldest
  first; flags read from the core for display), `/clinician/intake/[id]` detail +
  action bar, `/api/clinician/decide`. Patient `/intake` shows the post-decision
  state. A dev-only **Become clinician/patient** toggle on `/dev/harness`
  (`/api/dev/set-role`) makes the two-actor walk runnable without seeding a
  clinician in the DB (mock-only test affordance, not product).
- **Boundary:** `queue_item` gained decision **pointers only** — `decided_by`
  (clinician account, no real identity), `decided_at`, `note_ref` + `rx_ref`
  (core pointers). The rationale and the script live ONLY in the core.
- **Proven on the live URL:** fast-lane intake -> appears in the clinician queue;
  approve -> `rx_issued` (+ script in the core); escalate -> `escalated`/full;
  refuse -> `refused` + patient signpost; a patient role hitting
  `/api/clinician/decide` is bounced to `/` (no decision). `npm test`: 43 passed.

## Verifying

Success = the functional OUTCOME on the deployed URL, not "I made an edit" and
not a localhost check. Run `npm test` and exercise the flow on the preview URL.
