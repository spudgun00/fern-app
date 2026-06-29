# CLAUDE.md

Guidance for Claude Code working in this repo (the Fern patient zone app).

## What this is

The authenticated patient + clinician app, a **separate repo and deployment**
from the static marketing site at `fern.care`. Auth, secrets, and per-user data
live only here. Authoritative spec: `docs/fern-patient-zone-build-spec.md` — read
it before building. Build is phased (P0…P7); **build one phase, prove its success
test on the deployed URL, then stop**. Do not build ahead of a passing test.

Status: **P2 built** (two-lane intake questionnaire + deterministic routing),
deployed at https://fern-app.jimgill.workers.dev. P0 (foundation + adapter spine
+ mocks) and P1 (account + ID verification) done. Success tests A (`npm test`,
36 passed) and B pass: on the deployed URL a verified patient completes the
menopause/HRT questionnaire and is routed deterministically to the lane shown on
screen — a clear continuing picture -> fast lane (`in_review_queue`), a seeded
risk flag (e.g. clot history) -> full lane (`intake_submitted`, lane `full`,
awaiting P6 booking), and a red-flag answer -> stop + signpost (no lane). P1's
Test C (real Stripe Identity test-mode path) is still wired-but-unclosed (needs
the Stripe test secrets set, see below). P3+ not started.

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

## Verifying

Success = the functional OUTCOME on the deployed URL, not "I made an edit" and
not a localhost check. Run `npm test` and exercise the flow on the preview URL.
