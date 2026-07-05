# Fern — End-to-End Showcase Playbook

**Goal:** wire the two repos into one operational site on `fern.care` + `app.fern.care` that a viewer can walk end to end, start to delivered, to showcase Fern and pull interest. **Demo-grade:** mock/test throughout, password-gated. Not a clinical launch, and it does not need one.

**The unlock:** because every step is mock (test-mode Stripe, mock clinician, mock pharmacy), this demo can ship **before** CQC, the clinical lead, or compliance sign-off. It is a product demonstration, not a clinic taking patients. Keep that framing honest with viewers; the "Demo stand-in" pills and the password gate do the rest.

**Two repos:**
- `fern-site` — marketing, Astro static, Cloudflare Pages (`fern-site-cpl.pages.dev`), repo `github.com/spudgun00/fern`, main.
- `fern-app` — patient app, Astro `output: 'server'`, Cloudflare Worker (`fern-app.jimgill.workers.dev`), repo `spudgun00/fern-app`, `d2-patient-surfaces`. Holds C1-C6, screening, the prescribing guard.

---

## 1. The target journey (what "full operation" means)

The continuous walk a viewer should complete without hitting a dead end:

| # | Step | Lives in | Real or mock |
|---|---|---|---|
| 1 | Land, understand what Fern is and what to do | `fern.care` (site) | real content |
| 2 | "How it works" map: screen → clinician → treatment → delivered | site | real content |
| 3 | Click **Start** | site CTA → app | the handoff (gap) |
| 4 | Create account | `app.fern.care` | real (Supabase) |
| 5 | ID check | app | Stripe Identity, test mode |
| 6 | Intake / health questions | app | real flow |
| 7 | Pay (screen or treatment) | app checkout C2 | Stripe **test mode** |
| 8 | Screening kit → results | app | mock screening |
| 9 | **Clinician reviews** and approves/refuses | app reviewer console | **mock clinician** (you) |
| 10 | Treatment confirmed, dispensed, delivered | app | mock pharmacy |
| 11 | Membership / ongoing care | app checkout C4 | Stripe test mode |

If a viewer can walk 1 → 11 on one domain without a dead link, a real payment, or waiting on a real doctor, the showcase works.

---

## 2. Current gaps (the honest list)

| Gap | What's missing | How it blocks the demo | Fixed in |
|---|---|---|---|
| ~~Domain cutover~~ **done** | `fern.care` already serves the new site | not a blocker | — (confirm only) |
| **No app subdomain** | `app.fern.care` doesn't resolve to `fern-app` | Nowhere to hand off to | Phase B (only DNS piece left) |
| **No handoff** | Site CTA doesn't point into the app; C1 built the CTA *text* swap, not the site→app link | Click Start → goes nowhere real | Phase C |
| **CTA state** | Default CTA is "Get early access" → waitlist | Viewer never enters the product | Phase C (`purchaseEnabled` on) |
| **Two password prompts** | Basic Auth is per-origin; site and app each prompt | Clunky, breaks the "one product" feel | Phase D |
| **Loop can't complete** | `rx_issued` needs a clinician action; no real doctor in a demo | Journey stalls at step 9, viewer never sees approve → delivered | Phase F |
| **Legibility** | Home has no obvious single "what do I do"; no journey map; no progress in-app | Viewer is lost even when wired | Phase E |
| **No shop** | OTC / wellbeing range + unified basket don't exist; the demo shows only the prescription path | Viewer doesn't see the full commercial surface (OTC margin line) | Phases S1-S4 (shop spec) |

Note: the waitlist blocker (Brevo DOI) and the CQC/clinical-lead gates are **not** on this list. The waitlist can stay parked; the demo doesn't use it. The clinical gates don't apply because the demo is mock. The domain cutover from the 06-28 notes is done for the apex; only `app.fern.care` remains.

---

## 3. Architecture — the two repos on one domain

```
                          ┌──────────────────────────────────────────┐
   visitor ──▶ fern.care ─┤  Cloudflare Pages → fern-site (static)    │
                          │  home · how-it-works · treatments · etc.  │
                          └───────────────┬──────────────────────────┘
                                          │  "Start" CTA (purchaseEnabled on)
                                          │  <a href="https://app.fern.care/start">
                                          ▼
                      ┌──────────────────────────────────────────────┐
   visitor ──▶ app.fern.care ─┤ Cloudflare Worker → fern-app (server) │
                      │  account · ID · intake · checkout · screening │
                      │  · reviewer console · dispensing              │
                      └──────────────────────────────────────────────┘

   shared: one password gate on *.fern.care · Supabase auth lives in the app only
```

- **Site is anonymous.** No login on `fern.care`. It just needs one honest CTA that links to the app.
- **App owns auth.** The viewer creates an account inside `app.fern.care` (Supabase). No cross-domain SSO needed for the demo, the site carries no identity.
- **The only cross-subdomain concern is the password gate** (Phase D), not app auth.

---

## 4. The playbook (sequenced)

Infra first (A, B — mostly Cloudflare dashboard/wrangler, your hands), then the builds (C-F — Claude Code).

### Phase A — Apex domain (DONE, confirm only)
`fern.care` already serves the new site. Nothing to cut over. Just confirm:
1. `https://fern.care` and `www.fern.care` both resolve to the `fern-site` Pages project (www → apex redirect in place).
2. The old `fern` worker no longer holds `fern.care` routes; retire it if it still exists.
3. `fern-subscribe` (waitlist worker) stays as-is; orthogonal.
**Success:** apex confirmed on the site. If already true, skip to Phase B.

### Phase B — Stand up `app.fern.care`
1. Add `app.fern.care` as a custom domain / route on the `fern-app` Worker (Cloudflare dashboard → Workers → fern-app → Triggers/Custom Domains, or `wrangler` route).
2. DNS: `app` CNAME/route to the worker (proxied).
3. Confirm the app's allowed hosts / base URL config includes `app.fern.care`.
**Success:** `https://app.fern.care` serves the app (behind the gate).

### Phase C — The handoff (Claude Code, `fern-site` + `fern-app`)
- Turn `purchaseEnabled` on for the demo build so the site CTA reads "Start your health screen" / "Start your assessment".
- Point every start CTA at `https://app.fern.care/start` (one canonical entry).
- In `fern-app`, add a `/start` entry route that receives a cold visitor and kicks off account creation → the journey. Not a mid-flow drop.
**Success:** on `fern.care`, Start → lands on the app's `/start` → account creation begins.

### Phase D — One password gate across `*.fern.care` (Claude Code / config)
- Simplest: set the **same Basic Auth credentials** on both the Pages site and the app worker, so it's one username/password even if prompted twice.
- Nicer (recommended for a smooth demo): replace Basic Auth with a **cookie gate** — a small password page that sets a cookie on `domain=.fern.care`, read by both site and app, so the viewer authenticates once.
**Success:** viewer enters one credential and moves between `fern.care` and `app.fern.care` without a second challenge (cookie gate) or with the same creds (Basic Auth).

### Phase E — Legibility (Claude Code, `fern-site` + `fern-app`)
The fix for "a customer has no idea what to do":
- **Home:** one unmistakable primary CTA ("Start your health screen"), and a short "Here's how it works" strip near the top.
- **A "How it works" page** on the site: the 5-step map (screen → clinician reviews → treatment if right for you → delivered → ongoing care), each step one line, ending in the Start CTA. Education, compliant pre-launch.
- **In-app progress:** a visible step indicator (e.g. "Step 3 of 6: your health questions") so the viewer always knows where they are and what's next.
**Success:** a first-time viewer, given only `fern.care`, knows what to do at every step without being told.

### Phase F — Make the loop complete for a demo (Claude Code, `fern-app`)
The critical one. `rx_issued` must come from a clinician action (hard line, do not bypass). For a demo, provide a **mock clinician**, don't remove the guard:
- Expose the **reviewer console** (the P3 review queue) as a demo-walkable surface. You log in as the reviewer, see the pending patient, and click approve/refuse. This *showcases* the guard as a feature: "a clinician must act; here's where they do."
- Optionally a demo-only "auto-approve after N seconds" toggle for hands-free walk-throughs, but the console is the better story for investors, it proves the clinician-in-the-loop moat.
- Then the patient advances approve → `rx_issued` → dispensing (mock) → delivered, all visible.
**Success:** a viewer can watch a patient go from paid → screened → **approved by a (mock) clinician** → delivered, without a real doctor, and the hard-line tests still pass unchanged.

### Phase G — End-to-end walk + verification
Walk 1 → 11 yourself on the live domain with demo flags on. Checklist in §6.
**Success:** no dead links, no real charges, loop completes, one gate, legible throughout.

---

## 5. The safety boundary (what stays mock/gated — do not cross)

| Layer | Demo state | Never in the demo |
|---|---|---|
| Payments | Stripe **test mode**, "Demo stand-in" pill | Live Stripe keys |
| Prescribing | Mock clinician via reviewer console; guard intact | Real GMC clinician, real script |
| Pharmacy | Mock dispensing | Real CloudRx dispense |
| Access | Password gate on `*.fern.care` | Public, ungated |
| Claims | "Product demonstration"; drug content flag-gated | "We are a live, CQC-registered clinic" |
| Hard line | `RX_ISSUED_PREDECESSORS` unchanged; mock clinician still *acts* | Bypassing the guard to auto-issue |

The demo shows the *machine working*. It must never represent Fern as operating on real patients. That representation waits for CQC + clinical lead + compliance, same as always.

---

## 6. Sequencing + verification

Two tracks that run in parallel. The **wiring track** joins the repos; the **shop track** builds commercial breadth. They only converge at S3 (the shop checkout reuses the wiring's checkout surface).

**Wiring track (do first — it's what makes the demo a demo):**
`A confirm` → `B` (infra, you) → `C` handoff → `D` one gate → `E` legibility → `F` demo clinician loop → `G` walk.

**Shop track (parallel, additive — the OTC surface):**
`S1` catalogue + shop pages → `S2` unified cart → `S3` unified checkout + fulfilment router → `S4` per-line refunds. Full detail in the shop + basket spec.

**Dependencies:**
- C needs B (app subdomain must resolve before the CTA points at it).
- S1 has **no dependency** — it can start in Claude Code immediately, in parallel with your DNS work.
- S3 reuses the C2 checkout, so it slots in after the wiring's checkout is confirmed; S2 and S1 don't.
- F may partly exist already (P3 review queue). Check what's built before rebuilding; the job may be *exposing* the console for the demo, not writing it.

**Suggested parallelisation:** you do B (app subdomain, ~10 min in Cloudflare) while Claude Code runs S1 (shop catalogue). Then C, then the rest.

**End-to-end checklist (Phase G):**
- [ ] `fern.care` serves the site (confirmed); `app.fern.care` serves the app
- [ ] Home has one clear Start CTA + a "how it works" path
- [ ] Start → app `/start` → account creation (no dead link, no mid-flow drop)
- [ ] One password credential covers both subdomains
- [ ] Pay steps run in test mode with the demo pill; no real charge
- [ ] OTC shop browsable; a mixed basket (OTC + treatment) checks out in one payment
- [ ] OTC ships immediately; the prescription line waits for review; no script issued on payment
- [ ] Reviewer console lets you approve a patient as the mock clinician
- [ ] Patient completes approve → delivered, visibly
- [ ] In-app progress indicator present at each step
- [ ] Hard-line tests unchanged and green
- [ ] Nothing claims live/operating status to viewers

---

## 7. Claude Code prompts (one phase per session)

**Phase C — handoff:**
> In fern-site and fern-app: turn on purchaseEnabled for this build so site CTAs read "Start your health screen" (menopause) / "Start your assessment" (weight, behind weightLossRx). Point every start CTA at https://app.fern.care/start. In fern-app, add a /start entry route that receives a cold visitor and begins account creation → the existing journey (registered → ID → intake), not a mid-flow drop. Prove: on the site, Start links to app.fern.care/start; hitting /start cold begins account creation. Do not push. One commit + note per repo, then stop.

**Phase D — one gate (cookie version):**
> In fern-site and fern-app: replace the per-origin HTTP Basic Auth with a shared cookie gate. A small password page sets an auth cookie on domain=.fern.care; both the site and the app read it and allow access when present, redirect to the password page when absent. One password, set via env. Prove: entering the password once on fern.care lets you move to app.fern.care without a second challenge; clearing the cookie re-locks both. Do not push. Stop.

**Phase E — legibility:**
> In fern-site: add a clear single primary CTA on the home hero ("Start your health screen") and a short "how it works" strip near the top; add a /how-it-works page with the 5-step journey (screen → clinician reviews → treatment if appropriate → delivered → ongoing care), each step one line, ending in the Start CTA. In fern-app: add a visible step indicator across the journey ("Step N of M: <label>"). Allara design system. Prove: a first-time viewer given only fern.care can reach the app and always sees what's next; step indicator shows on every app journey screen. Do not push. Stop.

**Phase F — demo clinician loop:**
> In fern-app: expose the reviewer console (P3 review queue) as a demo-walkable surface — a reviewer logs in, sees pending patients, and clicks approve or refuse, advancing the patient. Add an optional demo-only "auto-approve after 10s" toggle (env-gated, off by default). Approve → rx_issued → mock dispensing → delivered, all visible to the patient view. DO NOT weaken the hard line: rx_issued still only from approved|consult_done via the (mock) clinician action; the 3 hard-line tests stay unchanged and green. Prove: a full walk pay → screen → approve (as mock clinician) → delivered completes without a real doctor; hard-line tests green. Do not push. Stop.

---

*Fern · end-to-end showcase playbook · internal · demo-grade, mock/test, password-gated. Reconcile into repo /docs. Live/operating status waits for CQC + clinical lead + compliance.*
