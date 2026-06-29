# CLAUDE.md

Guidance for Claude Code working in this repo (the Fern patient zone app).

## What this is

The authenticated patient + clinician app, a **separate repo and deployment**
from the static marketing site at `fern.care`. Auth, secrets, and per-user data
live only here. Authoritative spec: `docs/fern-patient-zone-build-spec.md` — read
it before building. Build is phased (P0…P7); **build one phase, prove its success
test on the deployed URL, then stop**. Do not build ahead of a passing test.

Status: **P0 done** (foundation + adapter spine + mocks), deployed at
https://fern-app.jimgill.workers.dev. P1+ not started.

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
  `MockCore` (Supabase `mock_*` tables), `MockCoreB` (in-memory), `MockDispensing`.
- Factory: `getClinicalCore()` / `getDispensing()` pick the impl from `CORE_IMPL`
  / `DISPENSING_IMPL` (default `mock`). Never branch on the impl anywhere else.
- Journey state machine: `src/lib/journey/`. Illegal transitions throw.
- App-DB helpers: `src/lib/accounts.ts`. Env: `src/lib/env.ts`. Supabase clients:
  `src/lib/supabase/`. Per-request wiring: `src/middleware.ts`.

## Hard rules (in code, do not weaken)

- **A clinician makes every prescribing decision.** `rx_issued` is reachable
  ONLY from `approved` or `consult_done` in `ALLOWED_TRANSITIONS`; a test
  asserts no other predecessor exists. No questionnaire-only auto-dispense.
- **Article 9 / clinical content lives only behind the clinical core adapter**,
  never in the app DB. App-DB tables (`account`, `journey`, `queue_item`,
  `booking_ref`, `payment_ref`) hold non-clinical state only; `queue_item` holds
  pointers only. The `mock_*` tables are a throwaway dev stand-in, deleted when
  the real core is wired.
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

## Runtime gotchas (cost real time in P0)

- **Env on Workers:** Astro v7 removed `Astro.locals.runtime.env`. Read bindings
  via `import { env } from 'cloudflare:workers'` (see `src/middleware.ts`), passed
  to `readEnv`. `readEnv` falls back to `process.env` for dev/tests.
- **CSRF:** Astro's default `checkOrigin` 403s form POSTs without an `Origin`
  header. Browsers send it; `curl` tests must add
  `-H "Origin: https://fern-app.jimgill.workers.dev"`.
- **Adapter bindings:** image processing is `passthrough` (no IMAGES binding);
  Astro sessions need the `SESSION` KV namespace (bound in `wrangler.jsonc`).
- **Supabase keys** were not pre-filled in `.dev.vars`; fetch with
  `supabase projects api-keys --project-ref fvpmjlrtfvjxpiilzmtb -o json`.

## Verifying

Success = the functional OUTCOME on the deployed URL, not "I made an edit" and
not a localhost check. Run `npm test` and exercise the flow on the preview URL.
