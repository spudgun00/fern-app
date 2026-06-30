# Fern — Demo build spec (the showable slice)

**For:** the Claude Code instance turning the proven P0–P6 patient zone into a polished, self-walkable DEMO.
**Pairs with:** `docs/fern-patient-zone-build-spec.md` (the operable-slice build, P0–P7 — read first; this spec sits ON TOP of it and does not re-open it) and `CLAUDE.md` (architecture, adapter spine, hard lines, deploy gotchas).
**Companion visual target:** the marketing repo `spudgun00/fern`, cloned locally as a sibling at `../fern-marketing`. The single source of truth for the look:
- `tokens/colors.css`, `tokens/typography.css`, `tokens/spacing.css`, `tokens/fonts.css` — the palette, scale, type and webfonts (the canonical tokens).
- `docs/fern-home-assembled.html` and `src/pages/symptoms.astro` + `src/components/sections/Hero.astro` (+ `docs/fern-symptoms-and-hero-spec.md`) — the rendered visual targets, how it is meant to look assembled.
- `src/layouts/BaseLayout.astro`, `src/components/{Header,Footer,FernMark,Wordmark,SymptomTile}.astro` — the real card / band / button / accordion rules.

**Scope of this version:** the **demo polish track (D1–D7)**, specced in depth and ordered for build. It makes the app LOOK and FEEL like Fern, lets a reviewer self-walk every happy and sad path, switches on the real services that are already built (in test mode), and adds the one missing realism piece (email) — while the **regulated core stays deliberately on MOCK**.

---

## What this is

P0–P6 are built and proven on mocks, but unstyled — the app looks like a test harness. This track closes the gap to a **complete, polished, self-walkable DEMO on dummy data**: everything switched on EXCEPT the regulated core (clinical record + real prescribing stay mock), built entirely on free tiers.

**Purpose (three audiences):** showable to a prospective clinical lead; usable as evidence for CQC; a way to pressure-test the experience. It is a **demonstration, NOT a soft launch**. No real patients, no live care, no real clinician identity. The "demonstration, not yet operating" status is stated on every screen (D1).

This track is **orthogonal to the light-core-vs-Semble decision** and must not block on it. `CORE_IMPL` and `DISPENSING_IMPL` stay `mock` throughout; the clinical record and CloudRx remain the throwaway `mock_*` stand-ins exactly as today.

---

## Constraints (do not re-open)

These carry from the patient-zone build and the architecture; this track honours them, it does not revisit them.

- **The regulated core stays MOCK on purpose.** `CORE_IMPL=mock`, `DISPENSING_IMPL=mock` for the whole track. No real clinical record, no real prescribing, no real dispensing. The demo proves experience + the non-clinical service ring, never live care.
- **A clinician makes every prescribing decision.** The journey state machine, `decideClinicianAction`, and `decideConsultAction` are NOT touched by this track. `rx_issued` stays reachable only from `approved` / `consult_done`. No demo affordance auto-issues a script. Persona seeding (D4) drives the patient TO a clinician decision point; a clinician (or a clearly-fenced dev action) still takes it.
- **Article 9 / clinical content lives only behind the core adapter.** Styling and demo plumbing never move answers, notes, or scripts into the app DB. No new app-DB column added by this track holds clinical content, card data, or PII (the existing denylist tests stay green).
- **RLS on every table, all access server-side via service_role.** Unchanged.
- **No real clinician identity in the product.** Demo clinician surfaces use a placeholder identity, same rule as the marketing site.
- **British English, no em dashes, no emoji in product copy.** The demo banner and all new copy obey this.
- **Faithful COPY, not a live share.** The app gets its OWN snapshot copy of the four token files, headed with their marketing-repo source path + copy date. Tokens do not change often; if the marketing palette ever changes, re-sync manually — the app does not inherit automatically. This is the deliberate two-repo cost, paid once.

---

## The design-system trap (load-bearing, read before D1)

`tokens/colors.css` carries an explicit caveat: several marketing components (**Button, Chip, Badge, Eyebrow, TextField**) contain **hardcoded warm hex** (`#E2A23C`, `rgba(226,162,60,…)`, `#9C7F9C`) that the Allara tokens **cannot override**. The marketing site builds sections from the tokens (see `fern-home-assembled.html`), not from those components verbatim.

**Rule for this track:** port the LOOK from the tokens + the assembled HTML reference, not by copying the warm-hardcoded components verbatim. When a primitive is reused (Button, TextField), de-warm it to the canonical tokens first. The canonical palette is the Allara direction: cream ground **`#F8F7F0`** (see the stale-token note below), navy `#1B1C3A` (all headings, primary actions, dark bands, footer), periwinkle `#C6CEF4` (accent SURFACE — never a button), lime `#D6F034` (rare pop only). Fonts: Fraunces (display serif), Inter (body/UI), JetBrains Mono (labels). Copy `fonts.css` faithfully (it loads the three families via the Google Fonts CDN, free); self-hosting via Fontsource is optional later hardening, out of scope here.

**Stale cream token — copy the CORRECTED system, not the file verbatim (load-bearing).** A token audit corrected the page-ground cream from the too-warm `#F4EFE5` to **`#F8F7F0`** (Allara's actual value). That fix has NOT landed in the marketing repo at HEAD — `tokens/colors.css` (lines 20 `--fern-cream` and 43 `--fern-text-inverse`), `docs/fern-home-assembled.html` (lines 12 `--cream` and 17 `--inv` + the `rgba(244,239,229,…)` derivations) and `src/layouts/BaseLayout.astro:72` (`theme-color`) all still ship `#F4EFE5`. So when D1 copies the tokens, it copies the corrected system, NOT the stale bytes: **replace every `#F4EFE5` with `#F8F7F0`** (both the ground at line 20 and the same-hex cream-on-navy `--fern-text-inverse` at line 43), and the `rgba(244,239,229,…)` inverse derivations become `rgba(248,247,240,…)`. Do NOT propagate `#F4EFE5` into the app as "faithful" — that re-copies a known bug. The other cream tokens are a different value and stay: `--fern-cream-2` / `--fern-on-navy` remain `#FBF8F1`. **Also flag to James:** the marketing repo needs the same `#F4EFE5 → #F8F7F0` correction (the audit didn't reach its `main`).

---

## The switch register (what flips, and what each flip needs)

The analogue of the patient-zone flag register. Every demo "switch" lives at the adapter boundary; nothing else in the app branches on it. Default everywhere is `mock` (the no-keys self-walk). Flipping a switch needs the external account + secrets + webhook noted, all free-tier, all test mode. The fallback is always: leave it `mock`.

| Switch | Adapter | Default | Flip needs (free, test mode) | Phase |
|---|---|---|---|---|
| `CORE_IMPL` | ClinicalCore | `mock` | **stays mock — never flipped in this track** | — |
| `DISPENSING_IMPL` | Dispensing | `mock` | **stays mock — never flipped in this track** | — |
| `IDENTITY_IMPL` | Identity | `mock` | `STRIPE_SECRET_KEY` (`sk_test_…`), `STRIPE_WEBHOOK_SECRET`; identity webhook endpoint | D6 |
| `PAYMENTS_IMPL` | Payments | `mock` | reuses `STRIPE_SECRET_KEY`; `STRIPE_PRICE_CONSULT`, `STRIPE_PRICE_MEMBERSHIP`, `STRIPE_BILLING_WEBHOOK_SECRET`; billing webhook + portal enabled | D6 |
| `BOOKING_IMPL` | Booking | `mock` | `CALCOM_API_KEY`, `CALCOM_EVENT_TYPE_ID`, `CALCOM_BOOKING_URL`, `CALCOM_WEBHOOK_SECRET`; `BOOKING_CREATED` webhook | D7 |
| `VIDEO_IMPL` | Video | `mock` | `DAILY_API_KEY`, `DAILY_DOMAIN` | D7 |
| `EMAIL_IMPL` | **Email (new, D5)** | `mock` | `RESEND_API_KEY` (or Brevo); a verified sending domain (see D5) | D5 |

**Resolution rule.** The mock self-walk must keep working with zero keys at all times (it is the reviewer's fast path). A real switch is flipped only once its secrets + webhook are set and its live-URL proof passes; if a key is missing, the switch stays `mock` and the demo still walks. Identity + Payments share one Stripe account (flip together in D6); Booking + Video are the consult pair (flip together in D7).

---

## Build order (polish on a proven spine)

Same cadence as the patient-zone build: **build one phase, prove its success test as an observable outcome on the deployed URL (`https://fern-app.jimgill.workers.dev`), then stop.** Do not build ahead of a passing test. `npm test` must stay green (currently 71) at every phase — this track adds tests, it does not weaken the journey/hard-line tests.

**Why this order.** The design foundation (D1) is the shell every later surface renders into (Layout, nav, banner), so it comes first and the patient (D2) then clinician (D3) surfaces are styled against it. With the surfaces looking like Fern, the persona switcher (D4) makes them self-walkable. Email (D5) adds realism to those walks. The real services (D6 Stripe, D7 Cal.com + Daily) flip last because they are the most external-setup-heavy and depend on nothing else — and a fully-styled, self-walkable demo is the right thing to point them at.

| Phase | Builds | Demo goal closed |
|---|---|---|
| D1 | Design foundation + app shell (tokens, Layout, nav, footer) + sitewide "demonstration, not operating" banner + P7 "coming" stubs | look begins; **goal 5** |
| D2 | Patient surfaces styled (intake, consult, room, treatment, billing, account) | **goal 1** (patient) |
| D3 | Clinician surfaces styled (console, queues, consult/intake detail) | **goal 1** (clinician) |
| D4 | Demo personas + self-walkable happy/sad path switcher | **goal 2** |
| D5 | Transactional email (new EmailAdapter, free tier) | **goal 4** |
| D6 | Test-mode wiring: Stripe Identity + Stripe Checkout/Billing | **goal 3** (money + ID) |
| D7 | Test-mode wiring: Cal.com booking + Daily video | **goal 3** (consult) |

Goal coverage map: **(1) design system on every surface** → D1+D2+D3; **(2) self-walkable happy+sad switcher** → D4; **(3) test-mode real services** → D6+D7; **(4) transactional email** → D5; **(5) demo banner + P7 stubs** → D1. All five goals are phased; none is left as a footnote.

---

## Surfaces (in build order)

Fields per phase: **Purpose · Build · Compliance/lines · Success test (observable on the live URL).**

### D1 · Design foundation + app shell + demo banner + P7 stubs

- **Purpose:** stand up the Fern look as a reusable shell so every later surface inherits it, and make the "this is a demonstration" status and the full nav (including "coming" areas) visible everywhere. This is the biggest lift; it converts the app from plumbing to Fern.
- **Build:**
  - `src/styles/tokens/{colors,typography,spacing,fonts}.css` — a faithful snapshot copy of the four marketing token files, each headed with its source path (`spudgun00/fern tokens/…`) and copy date. A single app entry stylesheet imports the four in order; every page pulls it in via the Layout.
  - `src/layouts/Layout.astro` — the shared shell, ported from the marketing `BaseLayout` pattern: cream ground, navy headings (Fraunces), Inter body, the page band/`max-width` rhythm, skip-link + landmarks for a11y, responsive from 320px up.
  - `src/components/` — shared `Nav` + `Footer` (ported from `Header`/`Footer`, de-warmed to canonical tokens per the trap above), plus the base primitives the app needs (Button, Card, Field, Banner, Pill/Status). Built from tokens, NOT copied warm.
  - **Demo banner (goal 5):** a sitewide `DemoBanner` rendered by the Layout on every route — "Demonstration, not yet operating. Dummy data, no real patients." — linking to a new one-line `/about-this-demo` page (states: regulated core on mock, no live care, CQC pre-registration). British English, no emoji.
  - **P7 "coming" stubs (goal 5):** routes + nav entries for **messages**, **documents**, **dashboard** that resolve to a clear, styled "coming soon" state. Nav reads as complete; no stub implies a live feature.
  - **Proof set this phase:** apply the shell to the entry + auth + account surfaces — `index`, `signup`, `login`, `account/profile`, `account/verify` — so the look is proven on real pages, not a sample page.
- **Compliance/lines:** no journey/logic change; pure presentation + nav. Banner copy and `/about-this-demo` make the non-operating status explicit (CQC-honest). Token files headed as faithful copies.
- **Success test:** on the deployed URL, `index` + `signup` + `login` + `account/profile` + `account/verify` render as Fern (cream ground, navy Fraunces headings, Inter body, the marketing card/band/button rules, periwinkle used only as a surface, no warm-hardcoded leftovers); the "demonstration, not operating" banner appears on **every** route including the clinician routes and `/about-this-demo` resolves; messages/documents/dashboard appear in nav and each renders a styled "coming" state; the app is legible and usable at 320px width; `npm test` still 71+ green.

### D2 · Patient surfaces styled

- **Purpose:** make the patient happy path look and feel like Fern end to end.
- **Build:** restyle, against the D1 shell + primitives, the patient surfaces: `intake` (the questionnaire — the core product screen, branching/progress styled), `consult` (pay-gate + booking entry), `consult/book/*` and `consult/room/mock` (the room), `treatment` (the plan: script, dispensing status, delivery tracking, repeat entry, the fenced dev advance-control kept but clearly fenced), `account/billing` (+ `billing/complete`, mock checkout/portal screens). Describe-never-diagnose phrasing preserved; routing/lane copy reads as a next step, not a diagnosis.
- **Compliance/lines:** presentation only; no change to intake routing, the pay-gate, journey transitions, or the mock-confirm affordances. No clinical content moved into the page that was not already shown.
- **Success test:** on the deployed URL, walk a patient from intake through to treatment — submit an intake, hit the consult pay-gate, reach the (mock) room, and view the treatment plan — and every screen is the Fern design (no harness pages left in the patient path); the existing flow still advances journey state exactly as before; `npm test` green.

### D3 · Clinician surfaces styled

- **Purpose:** make the clinician console look like Fern without touching the decision logic.
- **Build:** restyle `clinician/index`, `clinician/consults`, `clinician/consult/[id]`, `clinician/intake/[id]` against the shell: a real review-queue table/list (oldest first, flags + status as styled pills), the intake/consult detail read panel, and the action bar (**Approve + issue script | Escalate | Refuse** for the fast lane; **Issue | Refuse** for the consult) as proper buttons. Placeholder clinician identity only.
- **Compliance/lines:** `decideClinicianAction` / `decideConsultAction` untouched; the hard line (clinician-gated `rx_issued`, recorded reason + audit) is presentation-wrapped, not altered. The demo banner shows here too.
- **Success test:** on the deployed URL, a clinician views the styled queue, opens an intake, and Approves — the patient advances to `rx_issued -> dispensing` exactly as today, with the console now in full Fern styling; the consult console resolves the same room and Issue still advances `consult_done -> rx_issued`; `npm test` green.

### D4 · Demo personas + self-walkable path switcher (goal 2)

- **Purpose:** let a reviewer self-walk every deliberate happy AND sad path without knowing seeds. Built on the existing scenario spine (`src/lib/scenario.ts`, `/dev/harness`, `/api/dev/run-scenario`, `/api/dev/set-role`), not from scratch.
- **Build:**
  - Curated personas, each seeding a named outcome via the adapters + the journey machine (extending `runHarnessScenario` / `scenario.ts`): **fast-approve** (clear continuing → fast lane → clinician approve → script → dispense), **full-consult** (initiation → full lane → pay → book → room → issue), **red-flag stop** (hard red-flag answer → stop + signpost, no lane), **escalate** (fast → clinician escalate → full lane), **refuse** (clinician refuse → terminal + signpost), **cancel** (member cancels in the portal → benefit pulled). Each persona is idempotent-reset (re-running returns to a clean start), exactly as the harness already resets today.
  - A styled **reviewer control panel** (a proper Fern page, e.g. `/demo` or the restyled harness) listing the personas with a one-line description of the path each walks, a **role switch** (patient ↔ clinician), and a **reset**. A reviewer picks a persona, lands at the right point in the journey, and walks it to its end on the real styled surfaces.
- **Compliance/lines:** personas seed dummy data only; they drive the patient TO a clinician decision, they never auto-issue a script (the hard line holds — the clinician action, or a clearly-fenced dev step, still takes the decision). Mock-confirm affordances stay `instanceof Mock*`-gated. The panel is clearly a demo control, behind the demo banner. **Interaction note (carried to D6/D7):** auto-seeding relies on the mock-confirm affordances, so the "self-walk without knowing seeds" guarantee holds on the MOCK adapters; once D6/D7 flip a service to a real test-mode integration, that step becomes genuinely interactive (complete a real Stripe test checkout, pick a real Cal slot) — that is the separate "realism" walk, by design, not a regression.
- **Success test:** on the deployed URL, from the styled control panel a reviewer selects each of the six personas in turn and walks it to its terminal state on the real styled surfaces — fast-approve reaches a dispensed script; full-consult reaches a booked+issued consult; red-flag stops and signposts; escalate moves into the full lane; refuse terminates with a signpost; cancel pulls membership — all without editing code or knowing a seed; reset returns a clean slate; `npm test` green (personas covered by tests).

### D5 · Transactional email (goal 4)

- **Purpose:** the one genuinely missing realism piece — the emails a patient would actually receive.
- **Build:** a new `EmailAdapter` + `MockEmail` / `ResendEmail` behind `getEmail()` / `EMAIL_IMPL`, the same drill as the other adapters (REST via `fetch`, no SDK; default `mock` logs the email server-side for the no-keys walk). Hook the send at the existing journey events (compose, do not entangle — email is a notification side effect, never a gate): **welcome** (account created), **email-verify** (if used), **consult booked** (`-> consult_booked`), **script shipped** (`dispensing` / dispatch). Templates in Fern styling (navy header, cream ground, the wordmark), British English, no emoji.
- **Compliance/lines:** email is non-clinical and a side effect — no journey transition depends on an email; a failed send never blocks the flow (it logs). No Article 9 content in an email body (status + next step only, category-level, same restraint as patient copy). `EMAIL_IMPL=mock` keeps the no-keys demo whole.
- **Free-tier note (decide here):** Resend free (3,000/mo) can email arbitrary inboxes only after a **verified sending domain** (e.g. `fern.care`); unverified it sends to your own account address only. Brevo free (300/day) sends without a custom domain but stamps their branding. For a demo to a clinical lead, either verify a domain (cleanest) or send only to seeded test inboxes. Pick at the start of D5.
- **Success test:** on the deployed URL, with `EMAIL_IMPL` set and a key present, completing the relevant steps delivers the real emails to a test inbox — a welcome on sign-up, a "consult booked" on booking, a "script shipped" on dispatch — each in Fern styling; with `EMAIL_IMPL=mock`, the same steps log the composed email server-side and the flow is unaffected; `npm test` green (adapter round-trip + "email never gates" test).

### D6 · Test-mode wiring: Stripe Identity + Stripe Checkout/Billing (goal 3, money + ID)

- **Purpose:** switch on the two proven Stripe integrations in test mode, so ID verification and the money model are real (test-mode) flows, not mocks. Code already exists (`stripe-identity.ts`, `stripe-payments.ts`, both webhooks, both `/complete` polls) — this phase is account + secrets + webhook + flag-flip + live-URL proof, per `CLAUDE.md`.
- **Build:** set `STRIPE_SECRET_KEY` (`sk_test_…`) + `STRIPE_WEBHOOK_SECRET`; configure the identity webhook endpoint. Create the two test Prices, set `STRIPE_PRICE_CONSULT` / `STRIPE_PRICE_MEMBERSHIP`; set `STRIPE_BILLING_WEBHOOK_SECRET`; add the billing webhook endpoint and enable the customer portal. Flip `IDENTITY_IMPL=stripe` and `PAYMENTS_IMPL=stripe` in `wrangler.jsonc` `vars`. **Rebuild then deploy** (`npm run deploy` — never a bare `wrangler deploy`; the adapter compiles `wrangler.jsonc` at build time). Keep the mock paths intact as the keyless fallback.
- **Compliance/lines:** test mode only, no real charges, no real identity. Secrets are Worker secrets, server-only, never `PUBLIC_`. Webhook auth is the HMAC signature check (CSRF-exempt path, as documented). `CORE_IMPL`/`DISPENSING_IMPL` stay mock.
- **Success test:** on the deployed URL, a persona completes Stripe's **test-mode** Identity check and the journey advances to `id_verified` via the signature-verified webhook (the `/complete` poll as idempotent fallback); paying the consult fee via Stripe **test-mode** Checkout gates the full-lane booking and flips the consult gate; subscribing activates `active_member`; cancelling in the Stripe portal pulls the benefit — all on real Stripe test infrastructure; with the flags back to `mock`, the keyless walk still works; `npm test` green.

### D7 · Test-mode wiring: Cal.com booking + Daily video (goal 3, consult)

- **Purpose:** switch on the proven consult-pair integrations in test mode, so booking and the video room are real. Code already exists (`calcom-booking.ts`, `daily-video.ts`, the Cal.com webhook, the booking `/complete` poll) — account + secrets + webhook + flag-flip + proof.
- **Build:** create a free Cal.com account + a consult event type; set `CALCOM_API_KEY`, `CALCOM_EVENT_TYPE_ID`, `CALCOM_BOOKING_URL`, `CALCOM_WEBHOOK_SECRET`; add the `BOOKING_CREATED` (+ `BOOKING_RESCHEDULED`) webhook carrying `metadata[fernRef]`. Set `DAILY_API_KEY` + `DAILY_DOMAIN` (free Daily account). Flip `BOOKING_IMPL=calcom` and `VIDEO_IMPL=daily`; **rebuild then deploy**. Keep the mock booking/room as the keyless fallback.
- **Compliance/lines:** no real consult, placeholder identities, test-mode rooms. Webhook auth is the `X-Cal-Signature-256` HMAC. Note the known edge (carried from P6): the Cal.com poll scans only the last 50 bookings by `fernRef`, so the webhook stays authoritative — fine at demo volume. Core stays mock.
- **Success test:** on the deployed URL, after the consult pay-gate a patient books a **real Cal.com** slot, the `BOOKING_CREATED` webhook advances the journey to `consult_booked` and mints a **real Daily** room; the patient `/consult` page and the clinician `clinician/consult/[id]` console resolve the SAME real room URL and both can join; the clinician Issue advances `consult_done -> rx_issued -> dispensing`; with the flags back to `mock`, the in-app mock room still works; `npm test` green. **At D7's pass, all five demo goals are closed and the full demo is self-walkable on either the mock or the real-test-mode path.**

---

## Hard line + gates (carried, in code, every surface)

This track inherits the patient-zone hard lines unchanged and adds the demo-specific ones:

- **The regulated core stays MOCK.** No phase flips `CORE_IMPL` or `DISPENSING_IMPL`. The demo never presents real clinical record-keeping or real prescribing.
- **A clinician makes every prescribing decision.** No styling, persona, email, or service-flip path reaches `rx_issued` without the existing clinician action. The journey machine and the decision functions are not modified by this track.
- **Article 9 stays behind the core; the app DB stays pointers-only.** No new column holds clinical content, card data, or PII; the denylist tests stay green.
- **"Demonstration, not yet operating" is shown on every screen.** Plus `/about-this-demo`. The app is never presented as live care; CQC gates operating, not building/demoing.
- **No real patients, no real clinician identity, dummy data only.**
- **Free tier only**, every service in test mode; the keyless `mock` walk must always keep working.
- **Design system:** reuse the marketing tokens faithfully (the canonical Allara palette + Fraunces/Inter/JetBrains Mono); periwinkle is a surface never a button; lime is a rare pop; never redraw the fern mark; de-warm any reused primitive to the canonical tokens (the colors.css caveat).

---

## Claude Code working rules (carry from the build)

- **Success test = the functional OUTCOME on the deployed URL** (`https://fern-app.jimgill.workers.dev`), never "I made an edit", never a localhost check, never the model's say-so. Verify on the preview/deployed URL.
- Build one phase, prove its success test, then stop. Do not build ahead of a passing test. `npm test` stays green every phase.
- **Build before you deploy.** Editing `wrangler.jsonc` alone does not change what ships; the adapter compiles it into `dist/server/wrangler.json` at build time. Always `npm run deploy`, never a bare `wrangler deploy`. (Bit us on the `IDENTITY_IMPL` flip; it will bite again on D6/D7.)
- Secrets are Worker secrets (`wrangler secret put`), server-only, never `PUBLIC_`, never committed. Only the non-secret `*_IMPL` flags live in `wrangler.jsonc` `vars`. Local dev + tests read `.dev.vars`.
- British English, no em dashes, no emoji in product copy.
- The marketing repo is a **read-only design source** (sibling `../fern-marketing`); copy tokens/components into the app, never make the app depend on it at runtime.

---

## Env + repo notes

- **New env this track:** `EMAIL_IMPL` (`vars`, default `mock`) + `RESEND_API_KEY` (or Brevo equivalent, secret) for D5. Everything else (Stripe, Cal.com, Daily keys) already documented in `CLAUDE.md` — D6/D7 only set + flip them.
- **Flags flipped (in `wrangler.jsonc` `vars`):** `IDENTITY_IMPL`, `PAYMENTS_IMPL` (D6); `BOOKING_IMPL`, `VIDEO_IMPL` (D7); `EMAIL_IMPL` (D5). `CORE_IMPL` and `DISPENSING_IMPL` stay `mock`.
- **Design source:** `spudgun00/fern`, cloned at `../fern-marketing`. Source-of-truth files listed in the header. The app holds a faithful one-time copy of `tokens/*.css`.
- **This doc's home:** `docs/fern-demo-build-spec.md`. Update `CLAUDE.md`'s status line as each D-phase proves out, the same way P0–P6 were recorded.
