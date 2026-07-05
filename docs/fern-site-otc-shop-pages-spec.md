# fern-site OTC shop browse-pages spec (S1 hand-off)

This spec is for the **fern-site** repo (`../fern-marketing` / the `spudgun00/fern`
Pages project). The **data source** and all app-side shop/cart/checkout/fulfilment
were built in **fern-app** under shop phase S1-S4; the **public browse pages** are
built in fern-site against a copy of the catalogue data. This doc says exactly what
those pages need: routes, sections, the fields they read, and the compliance /
flag rules they must obey.

Nothing here is built in fern-app (per the shop spec split: browse/marketing lives
in fern-site; the basket + checkout + fulfilment live in fern-app).

---

## 1. The shared data source

fern-app owns the canonical catalogue at `src/data/otc-catalogue.ts`. fern-site
should carry a **faithful copy** of the same structure (mirror it the way the HRT /
weight catalogues were mirrored between the two repos) so both render identical
product data. Structure per line:

```ts
{
  id: string;                 // stable slug, e.g. "vitamin-d3"
  name: string;               // patient-facing product name
  category: OtcCategory;      // one of the 8 category ids below
  price: string;              // real retail markup, single figure, e.g. "£8*"
  patientDescription: string; // STRICTLY factual: what it is + how it is used
  authorisedClaims: string[]; // GB-authorised nutrition/health claims ONLY (may be [])
  flag: OtcCategory;          // == category (the per-category flag key)
  placeholder: boolean;       // true for the whole placeholder catalogue
  complianceFlag?: string;    // internal governance note — NEVER render to a buyer
}
```

Plus `OTC_CATEGORIES` (the 8 category descriptors: `{ id, title, blurb,
complianceNote }`) and the getters `getOtcCatalogue(flags)`,
`getOtcProduct(id, flags)`, `isCategoryEnabled(cat, flags)`.

The 8 categories, in display order (id -> title):
1. `intimate-vaginal` — Intimate and vaginal health
2. `menopause-supplements` — Menopause-support supplements
3. `bone-muscle` — Bone and muscle
4. `heart-brain` — Heart and brain
5. `energy-focus` — Energy and focus
6. `sleep-calm` — Sleep and calm
7. `skin-hair` — Skin and hair
8. `gut-general` — Gut and general

---

## 2. Flags (mirror fern-app's model)

fern-app gates on `OTC_SHOP_ENABLED` (master) + `OTC_CATEGORIES` (comma-separated
allowlist of enabled category ids). In fern-site, mirror this as
`PUBLIC_OTC_SHOP_ENABLED` (master) + `PUBLIC_OTC_CATEGORIES` (allowlist), following
the site's existing `flag()` helper convention in `src/config/features.ts`.

- **A category renders only when the master is on AND its id is in the allowlist.**
- **All OFF by default.** With the master off, the shop routes should 404 (use the
  `getStaticPaths()` guard pattern, exactly like `/weight-loss/[...slug].astro`, so
  a plain index cannot leak the page) and no OTC name/claim/price is emitted.
- Production turns categories on **one at a time** as each category's copy clears
  compliance.
- **Grep gate (static site):** with the shop off, `grep -riE` over `dist/` for any
  product name / claim string returns NOTHING. fern-site is static, so — unlike
  fern-app (`output: 'server'`, where the proof is a render walk) — the dist grep
  IS the valid proof there. Keep the drug/claim data behind the `{shop && …}`
  conditional inside a `<script is:inline>` (the weight-page lesson) so the strings
  are not hoisted into a JS chunk when the branch is off.

---

## 3. Routes

| Route | Purpose |
|---|---|
| `/shop` | Shop landing: the enabled categories as cards, each linking to its category page. Intro copy: what the shop is (everyday women's-wellbeing products), condition-neutral. |
| `/shop/[category]` | One category page per **enabled** category (`getStaticPaths` emits only enabled category ids). Lists that category's products. |
| `/shop/product/[id]` (optional) | A product detail page per enabled line, if a PDP is wanted; otherwise the category page card is the full unit. |

`getStaticPaths` for `/shop/[category]` returns only categories where
`isCategoryEnabled(cat, flags)` is true, so a not-yet-cleared category has no URL
at all.

---

## 4. Sections + which fields each reads

**`/shop` landing:**
- Hero / intro band: static copy (no product data). Condition-neutral: "everyday
  wellbeing", never "treats menopause".
- Category grid: one card per enabled category — reads `OtcCategoryInfo.title` +
  `.blurb`. Link -> `/shop/[category]`. (Do NOT render `complianceNote` — internal.)
- Compliance footer strip: a short, standing note that supplements are not a
  substitute for a varied diet / medical advice (standard supplement footer).

**`/shop/[category]`:**
- Category header: `OtcCategoryInfo.title` + `.blurb`.
- Product grid — per product card reads:
  - `name` (heading)
  - `price` (the `£XX*` markup; the `*` = provisional, footnote it)
  - `patientDescription` (the factual body)
  - `authorisedClaims[]` (render as a small bulleted "What it's for" list; when the
    array is **empty**, render NO claims block at all — a botanical / collagen /
    probiotic line shows only its factual description)
  - "Add to basket" CTA — see §5.
- **Never render `complianceFlag` or `complianceNote`** anywhere. They are
  governance text.

**`/shop/product/[id]` (if built):** same fields, fuller layout.

---

## 5. The basket hand-off (where fern-site meets fern-app)

The browse pages are **marketing/catalogue only**. The basket, checkout, payment
and fulfilment all live in fern-app. So an "Add to basket" action on a fern-site
product card should route the shopper into the fern-app purchase funnel carrying
the chosen OTC line id — the same way the entry CTAs route to the app's `/signup`
purchase funnel when `purchaseEnabled` is on.

- **Add-to-basket target:** the fern-app cart add endpoint (fern-app S2 exposes
  `POST /api/cart/add` with `{ type: 'otc', productId }`). fern-site links/POSTs to
  the app origin with the product id; the app validates the id + its category flag
  server-side (so a stale/off line cannot be added) and shows the unified cart.
- When the purchase funnel / shop is off, the card CTA falls back to the waitlist
  ("Get early access"), exactly like the app's existing off-state — no basket, no
  price action.
- **No payment, price capture, or PII on the static site.** fern-site only browses;
  the money + the account live in fern-app.

---

## 6. Compliance rules the pages must hold (§4 of the shop spec)

- **Authorised GB nutrition/health claims only.** Render `authorisedClaims`
  verbatim. Never add marketing copy that says "treats", "cures", "balances",
  "boosts", or names a condition as a benefit. The menopause-support category is
  the tightest: its cards must NOT imply the products help menopause — they show
  only the constituent-nutrient authorised claims (often an empty claims list).
- **No POM.** No melatonin, no hormonal intimate products — those are prescription
  lines, never in this catalogue. (fern-app asserts this with a POM denylist test.)
- **Placeholder discipline.** The whole set is provisional: show the `*` price
  footnote ("indicative, pending sign-off") and do not present the range as a
  finished shop until copy is signed off per category.
- **`noindex` until launch**, behind the site's password gate, like the weight /
  treatments pages.

---

## 7. Success test (fern-site side)

- Master flag OFF -> `/shop` + `/shop/[category]` 404; `grep -riE` over `dist/` for
  any product name or claim returns nothing.
- Master ON + a category in the allowlist -> that category page renders its
  products with prices and factual, authorised-claim-only copy; a category NOT in
  the allowlist has no page and no strings in `dist/`.
- No card renders a `complianceFlag` / `complianceNote`.
- `npm run build` clean, `npm run check` 0 errors.

---

*Fern · fern-site OTC shop browse-pages spec · hand-off from fern-app shop S1 ·
data mirrors `fern-app/src/data/otc-catalogue.ts` · flag-gated, placeholder,
compliance-cleared per category before any category flag goes public.*
