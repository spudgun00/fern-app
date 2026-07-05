# Fern — Unified Shop + Basket Build Spec

**Goal:** build the OTC / women's-wellbeing shop AND fold it into **one basket and one checkout** shared with the prescription flow. Build everything now, behind flags; turn categories on/off for production once compliance is understood per line. Demo-grade: mock fulfilment, Stripe test mode, password-gated.

**Extends:** the checkout spec (C1-C6). New phases here are **S1-S4**. **Repos:** shop surface + cart in `fern-site` where it's browse/marketing, the basket + checkout + fulfilment in `fern-app` (it already owns payment, the journey, and the guard).

---

## 1. The core model — one basket, split fulfilment

The whole design in one idea: **the basket is a set of typed line items; one payment; fulfilment routes each line by its type.** No "primary" product, no two checkouts.

```
        ┌──────────── ONE BASKET ────────────┐
        │  line: OTC        (type: otc)       │
        │  line: OTC        (type: otc)       │
        │  line: HRT/GLP    (type: prescription)
        └──────────────┬─────────────────────┘
                       │  ONE payment (Stripe test mode)
                       ▼
        ┌────────── FULFILMENT ROUTER ────────┐
        │                                      │
   type=otc ─────────────▶ fulfil now (mock dispatch). No clinician. Ships on payment.
        │
   type=prescription ────▶ enter the C2-C6 journey:
                            intake → screening → CLINICIAN REVIEW
                              approve → rx_issued → dispensing → delivered
                              refuse  → refund THAT line only
```

**The four basket shapes, all one model:**

| Basket | OTC lines | Prescription lines | Behaviour |
|---|---|---|---|
| OTC only | yes | none | pure e-commerce: pay → ships. No clinician, ever. |
| Treatment only | none | yes | the existing C2 flow. |
| Treatment + OTC | yes | yes | OTC ships now; treatment goes through the guard. |
| Weight + OTC | yes | yes | same: OTC ships now; GLP through the guard. |

Whichever the customer starts with, the other is just more typed lines. The router does not care which came "first".

---

## 2. The hard line, for mixed baskets (critical — do not weaken)

| Rule | Statement |
|---|---|
| Payment ≠ script | A basket payment gates OTC fulfilment + **entry to** the prescription journey. It NEVER reaches `rx_issued`. `RX_ISSUED_PREDECESSORS` stays `['approved','consult_done']`. |
| POM lines still gated | Every `prescription` line goes through clinician review. Buying it in a mixed basket changes nothing about the guard. |
| OTC never clinical | `otc` lines never touch clinical state, never enter the journey, never near `rx_issued`. |
| Per-line refund | Refusal refunds only the refused prescription line (the pay-first + auto-refund pattern, per line). OTC and approved lines are unaffected. |
| New test | A mixed-basket payment issues no script; the POM line reaches screening only; the OTC line fulfils; refuse → that line refunded. The 3 existing hard-line tests stay unchanged and green. |

---

## 3. The OTC catalogue (broader women's wellbeing)

Behind an `otcShop` master flag, with **per-category flags** so production can switch categories on individually as compliance clears them.

| Category | Example lines | Note |
|---|---|---|
| Intimate & vaginal health | non-hormonal vaginal moisturiser, lubricants, pH-balanced wash | non-hormonal only; anything hormonal is POM |
| Menopause-support supplements | isoflavone/red clover blends, sage, menopause multivit | claims discipline (§4) is tightest here |
| Bone & muscle | vitamin D3, magnesium, calcium | authorised claims exist for these |
| Heart & brain | omega-3, B-complex | |
| Energy & focus | B12, iron, adaptogen blends | this is the "focus" instinct, as a supplement |
| Sleep & calm | magnesium glycinate, L-theanine, herbal | **exclude melatonin — it is POM in the UK, not OTC** |
| Skin & hair | collagen, biotin, hyaluronic acid | |
| Gut & general | probiotics, fibre, women's multivit | |

- **Shared catalogue structure** (mirror the HRT catalogue): `{ id, name, category, price, patientDescription, authorisedClaims[], flag, placeholder }`. Real markup price (you set it), unlike POM pass-through.
- Mark the whole set `PLACEHOLDER_CATALOGUE` + per-line `placeholder: true` until product and copy are signed off, same discipline as the HRT list.

---

## 4. Compliance rulebook for OTC (different from POM)

OTC is **not** POM advertising. Consumer goods, freely advertisable. The trap is a different one:

- **Authorised health claims only.** Use only GB-authorised nutrition & health claims (the GB NHC register). Allowed: "vitamin D contributes to normal muscle function." Not allowed: "treats menopause", "balances your hormones", "boosts metabolism".
- **Supplements are food law, not medicines law** — but a product that claims to treat a condition, or acts pharmacologically, can be pulled into MHRA's medicines remit. Flag borderline lines (e.g. high-dose botanicals) for the pass.
- **Melatonin, and anything else POM, does not belong in the OTC catalogue.** If a line needs a prescription, it's a `prescription` line, not OTC.
- **The flag model is what makes "build everything now" safe:** every category is gated, nothing is public, and the compliance pass clears copy per category before that flag flips. Build first, clear per line, flip per line.

---

## 5. The unified checkout UX

- **Cart:** add OTC from the shop and treatment from the treatment flow into one cart. Each line shows its type.
- **Checkout** (extends the C2 `/checkout` surface): line items **grouped by fulfilment** so the customer understands the split:
  - "Ships now" (OTC)
  - "Pending clinician review" (prescription) — with the refund promise inline: "if a clinician can't prescribe this, you're refunded for it and the rest still ships."
- **Consent:** per prescription line (clinical consent). OTC needs none.
- **One payment**, Stripe test mode, "Demo stand-in" pill.

---

## 6. Fulfilment (mock for the demo, real later)

- **Demo:** OTC → mock dispatch (immediate "shipped" state). POM → mock dispensing on approval. Both visible in the patient view.
- **Production (later, real-world, not a code gap):** OTC brings stock, returns, VAT, and a carrier, an ops layer the pass-through pharmacy flow doesn't have. Note it now so it isn't a surprise; it's a business dependency, not a build blocker for the showcase.

---

## 7. Flags — everything toggleable

| Flag | Controls | Demo default | Production default |
|---|---|---|---|
| `otcShop` | the whole shop + cart OTC lines | ON | OFF until compliance |
| `otcCategory.*` | each OTC category individually | ON | per-category, as cleared |
| `purchaseEnabled`, `weightLossRx`, `menopauseRx` | existing | ON (demo) | OFF until gates |

Everything built, nothing public. Turn on per category for production once its copy is cleared.

---

## 8. Success tests

- **OTC-only:** add OTC → pay (test) → OTC fulfils ("shipped"), no clinical state touched.
- **Mixed (treatment + OTC):** pay → OTC ships immediately, POM enters screening, **no script issued**.
- **Refuse POM line:** that line refunded; OTC and any approved line unaffected.
- **Approve POM line:** `rx_issued` via clinician action only → dispensing.
- **Hard line:** 3 existing tests unchanged + the new mixed-basket test, all green.
- **Flags:** each OTC category off → render-walk clean in the app; grep-clean on the static site.
- `npm test` green. Do not push.

---

## 9. Build phases + Claude Code prompts (one phase per session)

| Phase | Builds | One-line success test |
|---|---|---|
| **S1** | OTC catalogue + shop browse pages, per-category flags | flags off → clean; on → categories render, factual claims only, prices shown |
| **S2** | Unified cart: typed line items, add from both the shop and the treatment flow | a cart can hold OTC + prescription lines together, each typed |
| **S3** | Unified checkout + fulfilment router (the hard part) | one payment; OTC fulfils now; POM enters screening; no script issued |
| **S4** | Per-line refund on refusal for mixed baskets | refuse one POM line → only that line refunded; rest unaffected |

**S1 prompt:**
> In fern-site (browse) and fern-app (data): build the OTC / women's-wellbeing catalogue as a shared source `src/data/otc-catalogue.*` — `{ id, name, category, price, patientDescription, authorisedClaims[], flag, placeholder }` — grouped by category (intimate/vaginal, menopause-support supplements, bone/muscle, heart/brain, energy/focus, sleep/calm, skin/hair, gut/general). Behind an `otcShop` master flag plus per-category flags, all OFF by default. Build the shop browse pages (Allara design). Rules: authorised GB nutrition/health claims only — never "treats/cures/balances"; exclude any POM (no melatonin); mark the whole set PLACEHOLDER_CATALOGUE + per-line placeholder:true. Prove: flags off → grep dist/ shows no product/claim strings; flags on → categories render with prices and factual claims only, no medical claims. npm run build clean. Do not push. Stop.

**S2 prompt:**
> In fern-app: build a unified cart that holds typed line items (`type: 'otc' | 'prescription'`), addable from both the OTC shop and the treatment flow. Show each line's type and its fulfilment label ("Ships now" / "Pending clinician review"). No checkout changes yet. Prove: a cart can contain OTC and prescription lines together, correctly typed and labelled. npm test green. Do not push. Stop.

**S3 prompt:**
> In fern-app: extend the C2 /checkout to accept a mixed cart and add the fulfilment router. ONE Stripe test-mode payment for the whole basket. Post-payment: `otc` lines → mock dispatch immediately; `prescription` lines → the existing journey (intake → screening → clinician review), gated as today. Group line items in the UI by fulfilment. DO NOT weaken the hard line: the basket payment gates OTC fulfilment + entry to the prescription journey, NEVER rx_issued; RX_ISSUED_PREDECESSORS stays ['approved','consult_done']; OTC lines never touch clinical state. Add a mixed-basket test: pay → OTC fulfils, POM reaches screening, no script issued; 3 hard-line tests unchanged. Prove all green. Do not push. Stop.

**S4 prompt:**
> In fern-app: implement per-line refund on refusal for mixed baskets, reusing the P4 auto-refund. When a clinician refuses a prescription line, refund only that line's amount; OTC and approved lines are untouched. Prove: mixed basket → refuse one POM line → only that line refunded, OTC still "shipped", any approved line proceeds; hard-line tests green. Do not push. Stop.

---

*Fern · unified shop + basket spec · internal · demo-grade, flag-gated, mock fulfilment. Extends the checkout spec. Compliance clears OTC copy per category before any category flag goes public.*
