# Fern — Patient zone build spec (the operable slice)

**For:** the Claude Code instance building Fern's authenticated patient + clinician app.
**Pairs with:** `docs/fern-session-handover-patient-zone.md` (the decision + architecture, read first) and `CLAUDE.md` (design system, tokens, repo). This spec is authoritative for the **patient zone build order and surfaces**. It does not re-open the decided architecture (Model B, rented record, CloudRx, two lanes); it sequences it.
**Companion visual target:** none yet. Reuse the public-site design system (tokens, type, components). App surfaces inherit the look; new app patterns are drawn against the same tokens.
**Scope of this version:** the **minimal operable slice** (the spine) specced in depth and ordered for build. The remaining surfaces are listed and stubbed, specced in depth later.

---

## What this is

The authenticated zone behind the marketing site: the first end-to-end path that proves the clinic works, from account + ID through to a clinician-signed script, dispensing, and paid membership. Built now, operated post-CQC (CQC gates operating, not building).

It is two-sided: patient surfaces AND a clinician console. Nothing operates without the clinician side, so it is part of the spine.

---

## Runtime + repo boundary (explicit decision, supersedes the static-only assumption)

**Invariant (conscious supersession, on the record, not slipped in).** The public marketing site is static Astro and **stays static**. The "static Astro, no SSR adapter" locked decision is preserved for the marketing site without exception. Server-side rendering, auth, secrets, and per-user data are confined to the **authenticated app only**. No marketing route gains a server runtime, a secret binding, or a clinical-data path. This is stated as a deliberate decision so the boundary is conscious, not a side effect of adding the app.

**Repo strategy: two repos (recommended).** The authenticated app is a **separate repository and a separate Cloudflare deployment** at `app.fern.care`, alongside the untouched static marketing site at `fern.care`. For a regulated app handling Article 9 data, deployment-level isolation beats a logical boundary inside one project, on the three dimensions that matter:
- **Security surface.** The marketing site holds no secrets, no server runtime, no PII path, so it cannot leak clinical data or keys, it is a pure static CDN artifact. The app is a smaller, locked-down target with its own access controls and its own dependency tree (no shared supply-chain surface with the public high-traffic site).
- **Deploy risk.** Marketing iterates fast and freely pre-launch; the clinical app deploys on its own cadence under change control. A broken marketing deploy cannot touch the running app, and rollbacks are scoped to one system.
- **Compliance boundary.** The regulated system is a discrete, separately-testable artifact with a clean data-flow boundary, which simplifies the DPIA, DSPT/IG scoping, and pen-test scope. "The marketing site never touches patient data" becomes provable, not asserted. Retrofitting this split later costs more than starting split.
- **Bonus.** The currently clean, working marketing site is left untouched, no adapter retrofit, no prerender-flag churn, no regression risk.

**Cost of the split (paid once).** A design-system sharing mechanism so the app reuses the locked tokens and shared primitives without drift. Because the palette is **locked** and the app needs a largely different component set anyway (auth, queue, consult console, billing), drift risk is low: share tokens via a small private package or a synced `tokens/` directory, copy the few shared primitives (Button, TextField). One-time setup, not ongoing risk.

**One-repo fallback (if you prefer lower setup overhead).** A single Astro project with `@astrojs/cloudflare`, `output:'hybrid'`, every marketing page `export const prerender = true`, app routes server-rendered. Trivial design-system reuse, at the cost of a shared pipeline, a shared dependency tree, a logical-only compliance boundary, and modifying the currently-clean marketing site. The invariant above still holds in this case: marketing routes stay prerendered and never touch secrets. Flip between the two is a config change plus moving the app folder; the surfaces below are identical either way.

---

## Decided architecture (recap, do not re-open)

| Layer | Decision |
|---|---|
| Patient + clinician screens | **BUILD** (Fern's own front-end) |
| Clinical record + prescribing core | **RENT** (light core or Semble, resolved by the API check, see flag register) |
| Dispensing | **CloudRx** (GPhC-registered, free API, patient-funded) |
| Auth, app DB, booking, video, payments, ID | **Infra** on free tiers, host-agnostic |
| Intake | **Two lanes**, both clinician-gated (fast: async review; full: video consult) |
| Money | First script priced as a consult; repeats via membership |

The hard line, baked in below: **a clinician makes and signs the prescribing decision in both lanes. No questionnaire-only auto-dispense.**

---

## The spine: one architecture that stays record-host-agnostic

What keeps this buildable now, before the light-core-vs-Semble check resolves: **all clinical-record and prescribing operations go through one adapter interface.** Build a mock implementation now; swap the real core in later. Every light-vs-Semble flag lives at this boundary and nowhere else.

**`ClinicalCoreAdapter` (the clinical boundary)**
- `createPatient(profile) -> corePatientId`
- `getPatient(corePatientId)`
- `saveIntake(corePatientId, intakePayload) -> intakeId`
- `getIntake(intakeId)`
- `listReviewQueue(filter) -> IntakeSummary[]`  *(queue may be core-native or app-side, see flag 2)*
- `createConsultNote(corePatientId, note) -> noteId`
- `issuePrescription(corePatientId, rxRequest) -> rxId`  *(FLAG 1: core e-prescribing vs CloudRx-direct)*
- `getPrescriptions(corePatientId) -> Rx[]`
- `createRepeatRequest(corePatientId, rxRef) -> requestId`

**`DispensingAdapter` (the CloudRx boundary)**
- `submitPrescription(rx) -> dispenseId`
- `getDispenseStatus(dispenseId) -> status`
- `getDeliveryTracking(dispenseId) -> tracking`

**Implementations**
- `MockCore` + `MockDispensing` now (in-memory or Cloudflare D1). The full spine builds and demos against these.
- `LightCore` / `Semble` and real `CloudRx` later, behind the same interfaces. No UI change on swap.

**Data split (compliance, load-bearing)**
- **Clinical content (UK GDPR Article 9)** lives in the **core**, never in the app DB: intake answers, notes, scripts.
- **App DB** (Cloudflare D1 or Supabase Postgres) holds **non-clinical app state only**: account, journey state machine, booking refs, payment refs, queue **pointers** (IDs, status, timestamps). Never clinical content.

**Infra (host-agnostic, free-tier)**

| Concern | Pick | Note |
|---|---|---|
| Auth + sessions + roles | Supabase Auth (or Clerk) | one provider; roles for patient vs clinician |
| App DB | Supabase Postgres or Cloudflare D1 | non-clinical state only |
| Booking | Cal.com | consult slots; Fern owns the booking UI |
| Video | Daily (or Whereby) | embeddable consult room |
| Payments | Stripe Checkout + Billing | consult fee + membership subscription |
| ID verification | Stripe Identity (or Persona) | document + selfie |

**The journey state machine (app DB, the through-line)**

```
registered -> id_pending -> id_verified -> intake_started -> intake_submitted ->
  fast:  -> in_review_queue -> (approved | escalated | refused)
  full:  -> consult_booked  -> consult_done
  both converge: -> rx_issued -> dispensing -> delivered
  membership:    -> active_member
```

A **clinician action gates the transition into `rx_issued` in both lanes** (the hard line). `escalated` re-routes a fast-lane patient into the full lane.

---

## Build order (spine before breadth)

Ordered for the **shortest path to a working end-to-end clinic loop**, then breadth. Each phase has a success test that is a **functional OUTCOME on the running app**, never "I made an edit." Verify on the preview/deployed URL.

**Why this order.** The **fast lane** (intake to async clinician approve to script to dispense to pay) is the minimal loop that proves the architecture, with no video or booking infra. It is built first because it is the **simplest end-to-end proof**, not because it is the primary clinical path. The **full lane** (initiation, the clinically-primary first-script path, P6) is required before real-patient launch and adds booking + video on top of the same spine. **New-patient operability is reached only at P6, not when the fast lane closes at P3:** the fast lane is the repeat/ongoing path, a new patient must initiate via the assessed lane. *If you would rather build the initiation lane first, swap P6 ahead of P3; the surfaces are independent.*

| Phase | Builds | Closes the loop? |
|---|---|---|
| P0 | App foundation + adapter spine + mocks | infra |
| P1 | Get in: account + ID | — |
| P2 | Intake: two-lane questionnaire + routing | — |
| P3 | Clinician console: review queue + async approve + script issue | **fast lane closes** |
| P4 | Script to CloudRx + patient status | dispensing |
| P5 | Payment + membership + repeat path | money |
| P6 | Full lane: booking + patient consult room + clinician consult console | **full lane closes** |
| P7 | Stub the rest (messages, documents, dashboard, reviews) | breadth later |

---

## Surfaces (in build order)

Fields per surface: **Purpose · Screens/states · Data · Infra · Compliance · Success test.**

### P0 · App foundation + adapter spine

- **Purpose:** stand up the authed runtime and the host-agnostic clinical boundary so everything else builds against mocks.
- **Build:** Astro Cloudflare adapter, `output:'hybrid'`; marketing routes `prerender=true`, app routes server-rendered; app on `app.fern.care` or `/app`. Supabase Auth (patient + clinician roles). App DB schema: `account`, `journey`, `booking_ref`, `payment_ref`, `queue_item` (pointers only). `ClinicalCoreAdapter` + `DispensingAdapter` interfaces + `MockCore`/`MockDispensing`. A dev/seed page that round-trips a mock patient + intake through the adapter and shows journey state.
- **Compliance:** app DB carries no Article 9 content; clinical content only via the core adapter.
- **Success test:** register, log in, and a dev page creates a mock patient, saves a mock intake, and advances journey state, all through the adapter, visible on screen. Swapping `MockCore` for a stub real impl requires zero UI change.

### P1 · Get in: account + ID

- **Surfaces (handover):** Account + login + ID verification.
- **Purpose:** a real, identity-verified account before any clinical step.
- **Screens/states:** sign up / log in; profile (name, DOB, contact, GP details + sharing consent OR a logged refusal with a recorded risk note); ID verification (Stripe Identity) to `id_verified`.
- **Data:** account + state in app DB; `createPatient` to the core (here or on first clinical step), returning `corePatientId` stored against the account.
- **Infra:** Supabase Auth, Stripe Identity.
- **Compliance:** ID verification required (hard line); GP info-sharing captured as consent or an explicit logged refusal + recorded risk explanation; no clinical data yet.
- **Success test:** a new user signs up, completes a test-mode ID check, records a GP-sharing choice, and lands at intake start with state `id_verified` and a `corePatientId` mapped.

### P2 · Intake: the two-lane questionnaire

- **Surface:** Clinical intake (the core product).
- **Purpose:** gather, screen, risk-flag, pre-fill, and route to the correct lane.
- **Screens/states:** a condition/medication-specific questionnaire (menopause / HRT): symptom picture, history, BP self-report, contraindication + risk screen (clot history, breast cancer, and the rest set by the reviewer), red-flag stops. Branching, with progress and save-and-resume.
- **Routing (deterministic, shown as the next step, never as a diagnosis):**
  - clear picture + repeat/ongoing -> **fast lane** (`in_review_queue`)
  - initiation, any risk flag, or an incomplete safety picture -> **full lane** (`consult_booked` path)
  - a hard red-flag answer -> stop + signpost (GP / NHS 111), no lane
- **Data:** `saveIntake(corePatientId, payload)` to the core (FLAG 3: structured-write capability); routing decision + status to app DB. Structured answers live in the core.
- **Compliance:** describe-never-diagnose phrasing throughout; the questionnaire never returns a diagnosis or a treatment recommendation, it routes. HRT initiation leans full lane by rule. Red-flag stops are clinically set content (mandatory review).
- **Success test:** completing the questionnaire writes a saved intake to the (mock) core and routes deterministically to the lane shown on screen; a seeded risk-flag answer forces the full lane; a red-flag answer stops and signposts.

### P3 · Clinician console: review queue + async approve + script issue (the load-bearing surface)

- **Surface:** Consultation room (the async review-queue half) + the prescribing action.
- **Purpose:** the human decision. A clinician reviews a fast-lane intake on screen and either approves + scripts or escalates to a consult. This surface is the entire reason Model B was chosen.
- **Screens/states:** clinician auth (role); the queue (fast-lane intakes, oldest first, status and flags surfaced); intake detail (the pre-filled clinical screen read from the core); the action bar: **Approve + issue script** | **Escalate to consult** | **Refuse + signpost** (with a recorded reason).
- **Data:** queue from app-DB pointers + content via `getIntake`; `createConsultNote` for the rationale; **`issuePrescription`** on approve (FLAG 1); state to `rx_issued` (approve), `consult_booked` (escalate), or terminal-refused.
- **Compliance (the hard line, in code):** the transition to `rx_issued` is reachable **only** through a clinician action; no path auto-issues; the clinician can always refuse or escalate; every decision records clinician + reason + timestamp.
- **Success test:** after a patient submits the fast lane, an item appears in the clinician queue; approving it issues a (mock) script and advances the patient to `rx_issued`; escalating moves the patient into the full lane; refusing terminates with a recorded reason and a patient-facing signpost. **No code path reaches `rx_issued` without a clinician action, proven by attempting it.**
- **What this proves, and what it does not.** A closed fast lane proves the spine mechanically, end to end (intake to clinician decision to script to dispense). It does **not** mean the clinic is operable for a new patient. The fast lane is the repeat/ongoing path; a real new patient must initiate via the full/assessed lane (P6: history + BP + risk + consult). This phase proves the mechanism, not new-patient readiness.

### P4 · Script to CloudRx + patient status

- **Surfaces:** Prescriptions + repeats (via CloudRx); a lightweight slice of My plan / treatment.
- **Purpose:** transmit the issued script to dispensing and let the patient see status.
- **Screens/states:** patient "your treatment" view: current script (the clinical record itself), dispensing status, delivery tracking; repeat-request entry for members.
- **Data:** `issuePrescription` result -> `DispensingAdapter.submitPrescription` (mock CloudRx) -> `dispenseId`; status/tracking via `getDispenseStatus` / `getDeliveryTracking`; state `dispensing -> delivered`.
- **Infra:** CloudRx adapter (mock now).
- **Compliance:** dispensing through a GPhC-registered pharmacy (CloudRx); patient-facing copy stays category-level (no medicine names in marketing-style copy); the clinical script content sits in the core/pharmacy record, not surfaced as promotional copy.
- **Success test:** an issued script shows as submitted-to-pharmacy with a patient-visible status; a mock transition (submitted -> dispatched -> delivered) reflects on the patient view; a member can lodge a repeat request that enters the review queue.

### P5 · Payment + membership + repeat path

- **Surfaces:** Membership + billing; payment woven through booking and the repeat path.
- **Purpose:** the money model, with first-vs-repeat tiering.
- **Screens/states:** consult payment (Stripe Checkout, ~£100) gating the full-lane booking and the first script; membership subscribe (Stripe Billing, ~£18/mo); billing portal (Stripe customer portal); repeat handling, where a member's repeat goes through the review queue (P3) with no new consult charge.
- **Data:** payment refs in app DB; subscription status drives `active_member`; tiering rule: first script = consult-priced, repeats = membership-covered.
- **Infra:** Stripe Checkout + Billing + customer portal.
- **Compliance:** transparent pricing (the public-site figures); medication is pass-through with an optional prescriber margin via CloudRx; no outcome or efficacy claims tied to price.
- **Success test:** paying the consult fee (test mode) gates the full-lane booking; subscribing creates an `active_member`; a member's repeat request reaches the review queue without a new consult charge; cancelling in the Stripe portal updates membership state.

### P6 · Full lane: booking + patient consult room + clinician consult console

- **Surfaces:** Booking; Consultation room (the video half, both sides).
- **Purpose:** the initiation / assessed lane, the clinically-primary first-script path. Required before real-patient launch.
- **Screens/states:** booking (Cal.com): pick a slot -> `consult_booked`; patient consult room (Daily video) at the slot; clinician consult console: join the same room with the intake on screen, write the note to the core, then **Issue script / Escalate / Refuse** (same action bar and hard line as P3).
- **Data:** booking ref in app DB; `createConsultNote`; `issuePrescription` (same FLAG 1); state `consult_booked -> consult_done -> rx_issued`.
- **Infra:** Cal.com, Daily.
- **Compliance:** same hard line; the script follows a real consult; initiation requires the history + BP + risk screen gathered at intake and confirmed in consult.
- **Success test:** book a slot, both patient and clinician join the video room at that slot, the clinician writes a note and issues a (mock) script, and the patient advances to `rx_issued -> dispensing`. The consult path reaches `rx_issued` only via the clinician action.
- **What this proves.** Closing the full lane is what makes the clinic operable for a **new** patient (initiation via the assessed lane), subject to CQC. The spine is only new-patient-complete at P6, not when the fast lane closed at P3.

### P7 · Stub the rest (listed, depth later)

Routes + nav entries + honest "coming" states, no depth yet:
- **Secure messages** — patient/clinician threaded messaging. Later: the post-care continuity channel.
- **Documents + records** — consult letters, prescription records, downloads. Later: likely core-generated PDFs (FLAG 6).
- **Patient dashboard** — the full home surface (plan, next review, messages, prescriptions at a glance). The P4 "your treatment" view is the minimal seed.
- **Reviews** — scheduled care reviews (the retention mechanic). Later: review cadence + reminders feeding the fast lane.
- **Success test (stub phase):** each route resolves, appears in nav, and renders a clear "coming" state; none implies a live feature.

---

## Light-core vs Semble: the flag register (resolve in parallel, do not block the spec)

Every point where the API check changes the build. All live at the adapter boundary; the rest of the spec is host-agnostic. Resolve via the core's API docs / sandbox. Until then, build against the mock.

| # | Build point | What the answer changes | Fallback if the core cannot |
|---|---|---|---|
| 1 | **e-prescribing** (`issuePrescription`) | Does the core originate the script natively, or must CloudRx originate it? Changes the clinician script action and whether the core touches scripts at all. | **CloudRx API originates the script**; the core stores the record only. Works with either core, favours the cheaper light core. |
| 2 | **async prescribing from your UI** (`listReviewQueue` + approve) | Can the clinician approve + script via the API from Fern's console, or must they enter the core's own portal UI to prescribe? If the latter, the fast lane breaks (the reason Model B was chosen). | If prescribing must live in the core UI: route scripts through CloudRx, use the core as the **record store only**, keep the queue app-side. |
| 3 | **structured intake write** (`saveIntake`) | Can the core accept the full structured intake payload, or only free-text notes? Decides whether structured answers live in the core. | Write a clinical **summary note** to the core + keep structure minimal, or lean to Semble (stronger API). Never park Article 9 structure in the app DB. |
| 4 | **patient create + stable ID** (`createPatient`) | The mechanism to create a core patient and map `corePatientId` to the account. Both should support it; confirm how. | None needed; confirm the call and ID stability. |
| 5 | **scheduling** | Does the core expose scheduling worth reusing, or does Fern own booking and write only the consult outcome? | Default: **Fern owns booking** (Cal.com), writes the outcome/note to the core. |
| 6 | **documents** (deferred, P7) | Does the core generate consult letters / script PDFs you would surface? | Defer; revisit at the Documents surface. |
| 7 | **dev sandbox** | Is there a free/cheap sandbox to build against, so you are not metered through months of build with no revenue? | **Stay on `MockCore`** until the core is chosen and sandboxed; the adapter makes the swap cheap. |

**Resolution rule.** If the core can satisfy 1 to 3 from its API (drive async prescribing + structured writes from Fern's UI), choose the **light core** (cheaper). If it cannot drive async prescribing from your UI, either choose **Semble** or apply the flag-1/2 fallback (CloudRx originates scripts, core is the record store) and keep the cheaper light core. Settle the sandbox (7) before building against any real core.

---

## Hard line + gates (in code, every clinical surface)

Baked into the build, not a compliance essay:
- **A clinician makes and signs every prescribing decision, both lanes.** No code path reaches `rx_issued` without a clinician action. No questionnaire-only auto-dispense.
- **ID verification** before any clinical step. **GP info-sharing** captured as consent or an explicit logged refusal with a recorded risk note.
- The clinician can always **refuse or escalate**; every decision records clinician + reason + timestamp.
- **HRT initiation leans to the full/assessed lane** (history + BP + risk screen). Repeats can run the fast lane.
- **Article 9 data lives in the core, never the app DB.**
- **CQC gates operating, not building.** Build and test the whole zone now against mocks; flip to the real core + real CloudRx + go-live only post-CQC. Never present the app as live care pre-registration.
- **No real clinician identity** (name, face, GMC number) in the product until the clinical lead is appointed. Same rule as the marketing site.
- **Design system:** reuse the public-site tokens and components; same Allara palette, Fraunces / Inter / JetBrains Mono, restraint over decoration; never redraw the fern mark; the casting rule holds for any imagery.

Regulatory basis (from the handover, verified Feb 2025): GPhC + GMC position on no questionnaire-only prescribing for assessed medicines; NICE NG23 + BMS for clinical content. Formal confirmation is James's compliance pass; attach formal source URLs there. No vendor API capability is asserted in this doc, that is the flag register's parallel check.

---

## Claude Code working rules (carry from the public-site build)

- **Success test = the functional OUTCOME on the running app**, never "I made an edit" or "verified by screenshot." Claude Code repeatedly reported done on changes that did not land; James verifies on the preview/deployed URL, not localhost, not the model's say-so.
- Gate-based: diagnose, propose, sample, apply. Build one phase, prove its success test, then the next. Do not build ahead of a passing test.
- Two repos (recommended): the app is its own repo + deployment at `app.fern.care`; the marketing site stays untouched and static. Reuse the design system via shared/synced tokens. Do not break the token flow (`styles.css` entry; tokens are the single source). Marketing routes never gain a server runtime or a secret.
- No em dashes, British English, no emoji in any product copy.

---

## Env + repo notes

- **New env (app routes):** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`; `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_CONSULT`, `STRIPE_PRICE_MEMBERSHIP`, `STRIPE_IDENTITY_*`; `DAILY_API_KEY`; `CALCOM_*`; `CLINICAL_CORE_*` (per chosen core); `CLOUDRX_*`. All test-mode or mocked until go-live.
- **`astro.config` (app repo):** `@astrojs/cloudflare`, `output:'server'` (or `'hybrid'` if any app route is static); auth, secrets, and per-user data live in this repo only. The marketing repo config is unchanged. *(One-repo fallback: a single hybrid project, marketing pages `prerender=true`, app routes server-rendered.)*
- **App location + repo:** separate repo + separate Cloudflare deployment at `app.fern.care` (recommended, see Runtime + repo boundary). The marketing site stays its own untouched static project at `fern.care`. Confirm DNS after the main domain cutover.
- **Suggested repo home for this doc:** `docs/fern-patient-zone-build-spec.md`.
