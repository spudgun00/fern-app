# fern-app

Fern patient zone — the authenticated patient + clinician app. Separate repo and
deployment from the static marketing site at `fern.care`.

**Phase P0** (this build): app foundation + the host-agnostic adapter spine +
mocks. Internal plumbing only; patient-facing design arrives in a later phase.
Authoritative spec: `docs/fern-patient-zone-build-spec.md`.

## Stack

- Astro (`output: 'server'`) on Cloudflare Workers via `@astrojs/cloudflare`.
- Supabase (EU) for auth + the non-clinical app DB. `@supabase/ssr` cookie
  sessions in server routes; a separate service_role admin client for
  privileged server-side writes.
- Vitest.

## Architecture (the spine)

All clinical-record and dispensing operations go through one adapter interface,
so the app stays record-host-agnostic until the real core is chosen.

- `ClinicalCoreAdapter` / `DispensingAdapter` — `src/lib/adapters/`.
- `MockCore` (persists to namespaced `mock_*` Supabase tables, dev-only) and
  `MockCoreB` (in-memory) prove the swap needs zero app/test changes.
- `getClinicalCore()` / `getDispensing()` select the impl from `CORE_IMPL` /
  `DISPENSING_IMPL` (default `mock`).
- Journey state machine — `src/lib/journey/`. Illegal transitions throw. Hard
  line: `rx_issued` is only reachable from `approved` or `consult_done`.

### Data split (compliance)

The app DB (`account`, `journey`, `queue_item`, `booking_ref`, `payment_ref`)
holds **non-clinical state only**. Clinical (Article 9) content lives only behind
the clinical core adapter. The `mock_*` tables are a throwaway dev stand-in for
the rented core and are deleted when the real core is wired. RLS is enabled on
every table with no policies; all access is server-side via the service_role
admin client.

## Environment

Local dev and tests read `.dev.vars` (gitignored). On the deployed Worker the
Supabase values are set as secrets (never committed); only the non-secret impl
flags live in `wrangler.jsonc`.

| Var | Notes |
|---|---|
| `PUBLIC_SUPABASE_URL` | project URL |
| `PUBLIC_SUPABASE_ANON_KEY` | legacy anon key; auth/session only |
| `SUPABASE_SERVICE_KEY` | legacy service_role key; **server-only**, never `PUBLIC_` |
| `CORE_IMPL` | `mock` (default) or `mockB` |
| `DISPENSING_IMPL` | `mock` (default) |

## Commands

```sh
npm test            # vitest: state machine + adapter round-trip (both impls)
npm run dev         # local dev (Cloudflare runtime via the adapter)
npm run build       # astro build
npm run deploy      # build + wrangler deploy
```

Apply the DB schema: `supabase db push` (migration in `supabase/migrations/`).

Set Worker secrets after the first deploy:

```sh
printf '%s' "$VALUE" | npx wrangler secret put PUBLIC_SUPABASE_URL
printf '%s' "$VALUE" | npx wrangler secret put PUBLIC_SUPABASE_ANON_KEY
printf '%s' "$VALUE" | npx wrangler secret put SUPABASE_SERVICE_KEY
```

## Dev harness

`/dev/harness` (logged in) → **Run scenario** runs end to end through the
adapters and the state machine: creates a mock core patient, maps
`core_patient_id`, advances the journey to `in_review_queue` (fast lane), saves a
mock intake, creates a `queue_item` pointer, and reads the intake back. Re-running
resets the journey to `registered` and runs fresh (idempotent).
