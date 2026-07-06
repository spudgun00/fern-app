// ===========================================================================
// Shop S1 — the OTC / women's-wellbeing catalogue (data source).
//
// The over-the-counter side of the shop: consumer goods (food supplements +
// non-hormonal intimate care), NOT prescription medicines. It is a SEPARATE
// catalogue from the HRT / GLP drug layers (src/lib/menopause/catalogue.ts) and
// obeys a DIFFERENT compliance rulebook (§4 of the shop spec):
//
//   * OTC is food / consumer-goods law, not medicines advertising. It is freely
//     advertisable, but a supplement may carry ONLY GB-authorised nutrition &
//     health claims (the GB NHC register). Allowed wording is "contributes to
//     normal ..." / "maintenance of normal ...". NEVER "treats", "cures",
//     "balances", "boosts", and never a claim to treat menopause or any
//     condition. A test asserts none of those verbs appears in any line.
//   * NO POM belongs here. Anything that needs a prescription (e.g. melatonin,
//     which is prescription-only in the UK; any hormonal intimate product) is a
//     `prescription` line elsewhere, never an OTC line. A test asserts the POM
//     denylist appears in no line.
//   * The whole set is a PLACEHOLDER (`PLACEHOLDER_CATALOGUE = true`, every line
//     `placeholder: true`) until product + copy are signed off per category, the
//     same discipline as the HRT list. Prices are real retail markup (not the POM
//     pass-through), single-figure working numbers the finance pass locks.
//
// GATING: an `otcShop` master flag plus a PER-CATEGORY flag, all OFF by default
// (see cta.ts / env.ts). A line resolves only when the master is on AND its
// category is enabled — so production can clear and switch on categories one at a
// time as their copy passes compliance. With everything off no OTC name, claim or
// price renders anywhere (the getters return []). Build-time data; its strings
// reach a rendered page only through the flag-gated getters.
// ===========================================================================
import type { CtaFlags } from '../lib/cta';

// The eight OTC categories, in display order. The id is also the per-category
// flag key (the flag that gates the whole category). Kept in sync with the
// OTC_CATEGORIES allowlist parsed in cta.ts.
export type OtcCategory =
  | 'intimate-vaginal'
  | 'menopause-supplements'
  | 'bone-muscle'
  | 'heart-brain'
  | 'energy-focus'
  | 'sleep-calm'
  | 'skin-hair'
  | 'gut-general';

export interface OtcCategoryInfo {
  id: OtcCategory;
  // Patient-facing heading for the category.
  title: string;
  // Patient-facing one-line description of what the category covers. Condition-
  // and claim-neutral: it describes the area of wellbeing, never a treatment.
  blurb: string;
  // The compliance note that anchors the category (shown in the governance
  // surface / to the compliance pass, not a marketing claim). Records WHY the
  // category needs its own clearance before its flag flips public.
  complianceNote: string;
}

export interface OtcProduct {
  id: string;
  name: string;
  category: OtcCategory;
  // Real retail price (markup, single figure). A working number; the finance pass
  // locks it. The trailing '*' marks it provisional (placeholder catalogue).
  price: string;
  // Patient-facing plain description: what the product IS and how it is used.
  // STRICTLY factual — no health/benefit claim lives here; the only permitted
  // benefit statements are the authorised claims in `authorisedClaims`.
  patientDescription: string;
  // GB-authorised nutrition & health claims ONLY, verbatim register wording. May
  // be empty: a product whose active has NO authorised claim (a botanical, a
  // topical, collagen, a probiotic) carries [] and leans on the factual
  // description alone. NEVER put an un-authorised claim here.
  authorisedClaims: string[];
  // The per-category flag that gates this line (equal to `category`). Duplicated
  // from category for spec fidelity; the getter gates on category + master.
  flag: OtcCategory;
  // Placeholder discipline: true for every line until product + copy sign-off.
  placeholder: boolean;
  // Set when a line needs extra scrutiny at the compliance pass: a borderline
  // botanical (could be pulled into MHRA's medicines remit), a topical that may be
  // a medical device, or an active with no authorised claim. Not patient-facing.
  complianceFlag?: string;
}

// The whole catalogue is provisional until sign-off (mirrors PLACEHOLDER_CATALOGUE
// on the HRT list). A test asserts this stays true while the catalogue is unproven.
export const PLACEHOLDER_CATALOGUE = true;

export const OTC_CATEGORIES: OtcCategoryInfo[] = [
  {
    id: 'intimate-vaginal',
    title: 'Intimate and vaginal health',
    blurb: 'Non-hormonal moisture and everyday intimate care for comfort.',
    complianceNote:
      'Non-hormonal only — any hormonal (e.g. local oestrogen) product is POM and belongs in the prescription catalogue, never here. A vaginal moisturiser may be a medical device (not a food supplement), so nutrition claims do not apply; classify each line and clear its copy before this flag flips.',
  },
  {
    id: 'menopause-supplements',
    title: 'Menopause-support supplements',
    blurb: 'Food supplements chosen with midlife in mind.',
    complianceNote:
      'Claims discipline is TIGHTEST here. There is NO authorised health claim for menopause, and none for red-clover isoflavones or sage, so no line may claim to help menopause. Multivitamin lines carry only the authorised claims of their constituent nutrients. Botanicals are borderline (possible MHRA medicines remit); clear every line individually.',
  },
  {
    id: 'bone-muscle',
    title: 'Bone and muscle',
    blurb: 'Nutrients with a role in normal bones and muscle.',
    complianceNote:
      'Authorised claims exist for these nutrients (vitamin D, calcium, magnesium). Use only the register wording; confirm the product delivers the significant amount the claim conditions require.',
  },
  {
    id: 'heart-brain',
    title: 'Heart and brain',
    blurb: 'Omega-3 and B vitamins for everyday support.',
    complianceNote:
      'The omega-3 heart / brain / vision claims are authorised only at a daily intake condition (e.g. 250 mg DHA/EPA); confirm the dose before the claim renders. B-vitamin claims are authorised at their significant amounts.',
  },
  {
    id: 'energy-focus',
    title: 'Energy and focus',
    blurb: 'Nutrients with a role in normal energy and tiredness.',
    complianceNote:
      'Iron / B12 / B-vitamin fatigue and energy claims are authorised. Adaptogen blends have no authorised claim and are borderline botanicals; flag them for the compliance pass and keep their copy factual.',
  },
  {
    id: 'sleep-calm',
    title: 'Sleep and calm',
    blurb: 'A calmer evening routine.',
    complianceNote:
      'EXCLUDES melatonin — it is prescription-only (POM) in the UK, not an OTC supplement. There is no authorised "sleep" claim for magnesium, L-theanine or valerian; magnesium may carry only its nervous-system / psychological-function claims, and the botanicals carry no claim. Do not imply a sleep benefit.',
  },
  {
    id: 'skin-hair',
    title: 'Skin and hair',
    blurb: 'Everyday support for skin, hair and nails.',
    complianceNote:
      'Biotin, zinc and selenium carry authorised skin / hair / nails claims. Collagen and hyaluronic acid have NO authorised health claim — those lines stay factual (authorisedClaims []) and must not imply a benefit.',
  },
  {
    id: 'gut-general',
    title: 'Gut and general',
    blurb: 'Fibre, a daily multivitamin and everyday basics.',
    complianceNote:
      'Probiotics have NO authorised health claim in the GB register (the term "probiotic" itself is treated as an implied claim) — keep those lines factual. Multivitamin claims come from their constituent nutrients only.',
  },
];

// The products. Category / consumer-goods level; real retail prices. Authorised
// claims are verbatim GB-register wording; a line whose active has no authorised
// claim carries [] and a complianceFlag.
export const OTC_PRODUCTS: OtcProduct[] = [
  // --- Intimate & vaginal (non-hormonal; topical / device, no nutrition claim) ---
  {
    id: 'vaginal-moisturiser',
    name: 'Non-hormonal vaginal moisturiser',
    category: 'intimate-vaginal',
    price: '£12*',
    patientDescription:
      'A non-hormonal, long-lasting vaginal moisturiser used every few days to help with everyday dryness and comfort. Fragrance-free.',
    authorisedClaims: [],
    flag: 'intimate-vaginal',
    placeholder: true,
    complianceFlag: 'Likely a medical device, not a supplement — classify and clear device copy before launch.',
  },
  {
    id: 'intimate-lubricant',
    name: 'Water-based intimate lubricant',
    category: 'intimate-vaginal',
    price: '£9*',
    patientDescription:
      'A pH-conscious, water-based lubricant for comfort during intimacy. Non-hormonal and fragrance-free.',
    authorisedClaims: [],
    flag: 'intimate-vaginal',
    placeholder: true,
    complianceFlag: 'Cosmetic / device classification to confirm; non-hormonal only.',
  },
  {
    id: 'ph-balanced-wash',
    name: 'pH-balanced intimate wash',
    category: 'intimate-vaginal',
    price: '£8*',
    patientDescription:
      'A gentle, pH-balanced external wash for daily intimate hygiene. Fragrance-free and soap-free.',
    authorisedClaims: [],
    flag: 'intimate-vaginal',
    placeholder: true,
    complianceFlag: 'Cosmetic classification; avoid any implied medical benefit in copy.',
  },

  // --- Menopause-support supplements (tightest claims discipline) ---
  {
    id: 'menopause-multivitamin',
    name: 'Midlife daily multivitamin',
    category: 'menopause-supplements',
    price: '£15*',
    patientDescription:
      'A once-a-day multivitamin and mineral formulated with midlife in mind, including vitamin B6, vitamin D and magnesium.',
    authorisedClaims: [
      'Vitamin B6 contributes to the regulation of hormonal activity',
      'Vitamin B6 contributes to normal psychological function',
      'Magnesium contributes to the reduction of tiredness and fatigue',
    ],
    flag: 'menopause-supplements',
    placeholder: true,
    complianceFlag: 'Must not claim to help menopause; only the constituent-nutrient claims are permitted.',
  },
  {
    id: 'red-clover-isoflavones',
    name: 'Red clover isoflavone blend',
    category: 'menopause-supplements',
    price: '£16*',
    patientDescription:
      'A food supplement providing isoflavones from red clover. One capsule a day.',
    authorisedClaims: [],
    flag: 'menopause-supplements',
    placeholder: true,
    complianceFlag: 'No authorised claim for isoflavones/phytoestrogens; borderline botanical — no menopause claim; clear individually.',
  },
  {
    id: 'sage-supplement',
    name: 'Sage supplement',
    category: 'menopause-supplements',
    price: '£11*',
    patientDescription: 'A food supplement providing sage (Salvia officinalis) leaf extract. One tablet a day.',
    authorisedClaims: [],
    flag: 'menopause-supplements',
    placeholder: true,
    complianceFlag: 'No authorised health claim for sage; botanical borderline — factual copy only.',
  },

  // --- Bone & muscle (authorised claims exist) ---
  {
    id: 'vitamin-d3',
    name: 'Vitamin D3',
    category: 'bone-muscle',
    price: '£8*',
    patientDescription: 'A once-daily vitamin D3 supplement.',
    authorisedClaims: [
      'Vitamin D contributes to the maintenance of normal bones',
      'Vitamin D contributes to the maintenance of normal muscle function',
      'Vitamin D contributes to the normal function of the immune system',
    ],
    flag: 'bone-muscle',
    placeholder: true,
  },
  {
    id: 'magnesium',
    name: 'Magnesium',
    category: 'bone-muscle',
    price: '£10*',
    patientDescription: 'A daily magnesium supplement.',
    authorisedClaims: [
      'Magnesium contributes to normal muscle function',
      'Magnesium contributes to the maintenance of normal bones',
      'Magnesium contributes to the reduction of tiredness and fatigue',
    ],
    flag: 'bone-muscle',
    placeholder: true,
  },
  {
    id: 'calcium',
    name: 'Calcium',
    category: 'bone-muscle',
    price: '£9*',
    patientDescription: 'A daily calcium supplement.',
    authorisedClaims: [
      'Calcium is needed for the maintenance of normal bones',
      'Calcium contributes to normal muscle function',
    ],
    flag: 'bone-muscle',
    placeholder: true,
  },

  // --- Heart & brain ---
  {
    id: 'omega-3',
    name: 'Omega-3 (DHA and EPA)',
    category: 'heart-brain',
    price: '£14*',
    patientDescription:
      'A daily omega-3 supplement providing DHA and EPA from fish oil.',
    authorisedClaims: [
      'DHA and EPA contribute to the normal function of the heart',
      'DHA contributes to the maintenance of normal brain function',
    ],
    flag: 'heart-brain',
    placeholder: true,
    complianceFlag: 'Heart/brain claims are conditional on a 250 mg DHA/EPA daily intake — confirm the dose delivers it.',
  },
  {
    id: 'b-complex',
    name: 'Vitamin B complex',
    category: 'heart-brain',
    price: '£11*',
    patientDescription: 'A daily B-complex providing the eight B vitamins.',
    authorisedClaims: [
      'Vitamin B12 contributes to normal functioning of the nervous system',
      'Riboflavin (vitamin B2) contributes to the maintenance of normal red blood cells',
    ],
    flag: 'heart-brain',
    placeholder: true,
  },

  // --- Energy & focus ---
  {
    id: 'vitamin-b12',
    name: 'Vitamin B12',
    category: 'energy-focus',
    price: '£9*',
    patientDescription: 'A once-daily vitamin B12 supplement.',
    authorisedClaims: [
      'Vitamin B12 contributes to normal energy-yielding metabolism',
      'Vitamin B12 contributes to the reduction of tiredness and fatigue',
    ],
    flag: 'energy-focus',
    placeholder: true,
  },
  {
    id: 'iron',
    name: 'Iron',
    category: 'energy-focus',
    price: '£8*',
    patientDescription: 'A daily iron supplement.',
    authorisedClaims: [
      'Iron contributes to normal formation of red blood cells and haemoglobin',
      'Iron contributes to the reduction of tiredness and fatigue',
      'Iron contributes to normal cognitive function',
    ],
    flag: 'energy-focus',
    placeholder: true,
  },
  {
    id: 'adaptogen-blend',
    name: 'Adaptogen blend',
    category: 'energy-focus',
    price: '£17*',
    patientDescription:
      'A food supplement providing a blend of adaptogenic herbs. One capsule a day.',
    authorisedClaims: [],
    flag: 'energy-focus',
    placeholder: true,
    complianceFlag: 'No authorised claim for adaptogens; borderline botanical blend — factual copy only, clear individually.',
  },
  // The "focus gum" model made compliant (spec appendix): caffeine + L-theanine are
  // FACTUAL ingredients only — neither has an authorised GB/EU claim, so no claim
  // rests on them. The claim lives only on the added B6 / B12 that earn it.
  {
    id: 'focus-clarity-gum',
    name: 'Focus & Clarity Gum',
    category: 'energy-focus',
    price: '£14*',
    patientDescription:
      'A chewable gum with caffeine, L-theanine and added B-vitamins.',
    authorisedClaims: [
      'Vitamin B6 contributes to normal psychological function',
      'Vitamin B12 contributes to the reduction of tiredness and fatigue',
    ],
    flag: 'energy-focus',
    placeholder: true,
    complianceFlag: 'Contains caffeine — no claim rests on caffeine or L-theanine (neither is authorised); the claim is on B6/B12 only, and the product must contain a significant amount (>=15% NRV) per serving to bear it. Caffeinated: carry the required high-caffeine labelling where thresholds apply.',
  },
  {
    id: 'daily-mind-complex',
    name: 'Daily Mind Complex',
    category: 'energy-focus',
    price: '£16*',
    patientDescription:
      'A daily capsule providing a B-complex with iron and zinc.',
    authorisedClaims: [
      'Iron contributes to normal cognitive function',
      'Pantothenic acid contributes to normal mental performance',
    ],
    flag: 'energy-focus',
    placeholder: true,
  },
  {
    id: 'magnesium-calm',
    name: 'Magnesium Calm',
    category: 'energy-focus',
    price: '£12*',
    patientDescription: 'A daily magnesium glycinate supplement.',
    authorisedClaims: [
      'Magnesium contributes to normal psychological function',
      'Magnesium contributes to the reduction of tiredness and fatigue',
    ],
    flag: 'energy-focus',
    placeholder: true,
  },

  // --- Sleep & calm (NO melatonin — POM; no authorised sleep claim) ---
  {
    id: 'magnesium-glycinate',
    name: 'Magnesium glycinate',
    category: 'sleep-calm',
    price: '£12*',
    patientDescription:
      'A daily magnesium supplement in the glycinate form, taken in the evening.',
    authorisedClaims: [
      'Magnesium contributes to normal functioning of the nervous system',
      'Magnesium contributes to normal psychological function',
    ],
    flag: 'sleep-calm',
    placeholder: true,
    complianceFlag: 'No authorised sleep claim — magnesium may carry only its nervous-system / psychological-function claims.',
  },
  {
    id: 'l-theanine',
    name: 'L-theanine',
    category: 'sleep-calm',
    price: '£13*',
    patientDescription: 'A food supplement providing L-theanine, an amino acid found in tea. One capsule a day.',
    authorisedClaims: [],
    flag: 'sleep-calm',
    placeholder: true,
    complianceFlag: 'No authorised claim for L-theanine; keep copy factual, no calm/sleep implication.',
  },
  {
    id: 'herbal-valerian',
    name: 'Valerian herbal supplement',
    category: 'sleep-calm',
    price: '£10*',
    patientDescription: 'A food supplement providing valerian (Valeriana officinalis) root extract.',
    authorisedClaims: [],
    flag: 'sleep-calm',
    placeholder: true,
    complianceFlag: 'No authorised claim for valerian; borderline botanical (a registered THR herbal exists — confirm this is sold as a supplement, not an implied medicine).',
  },

  // --- Skin & hair ---
  {
    id: 'biotin',
    name: 'Biotin',
    category: 'skin-hair',
    price: '£9*',
    patientDescription: 'A once-daily biotin supplement.',
    authorisedClaims: [
      'Biotin contributes to the maintenance of normal hair',
      'Biotin contributes to the maintenance of normal skin',
    ],
    flag: 'skin-hair',
    placeholder: true,
  },
  {
    id: 'collagen',
    name: 'Collagen powder',
    category: 'skin-hair',
    price: '£19*',
    patientDescription:
      'A daily collagen peptide powder to mix into a drink. Provides hydrolysed collagen.',
    authorisedClaims: [],
    flag: 'skin-hair',
    placeholder: true,
    complianceFlag: 'No authorised health claim for collagen — factual description only, no skin/hair benefit implied.',
  },
  {
    id: 'hyaluronic-acid',
    name: 'Hyaluronic acid supplement',
    category: 'skin-hair',
    price: '£16*',
    patientDescription: 'A daily food supplement providing hyaluronic acid. One capsule a day.',
    authorisedClaims: [],
    flag: 'skin-hair',
    placeholder: true,
    complianceFlag: 'No authorised health claim for oral hyaluronic acid — factual copy only.',
  },

  // --- Gut & general ---
  {
    id: 'probiotic',
    name: 'Daily probiotic',
    category: 'gut-general',
    price: '£18*',
    patientDescription:
      'A daily food supplement providing live cultures. One capsule a day.',
    authorisedClaims: [],
    flag: 'gut-general',
    placeholder: true,
    complianceFlag: 'The term "probiotic" is treated as an implied unauthorised claim in GB — review naming/copy before launch.',
  },
  {
    id: 'fibre',
    name: 'Fibre supplement',
    category: 'gut-general',
    price: '£10*',
    patientDescription:
      'A daily fibre supplement to mix into water or a drink.',
    authorisedClaims: [],
    flag: 'gut-general',
    placeholder: true,
    complianceFlag: 'Fibre claims (e.g. beta-glucans, specific fibres) are conditional — confirm the source before any claim renders.',
  },
  {
    id: 'womens-multivitamin',
    name: "Women's daily multivitamin",
    category: 'gut-general',
    price: '£13*',
    patientDescription:
      "A once-a-day multivitamin and mineral for women, including iron, vitamin D and B vitamins.",
    authorisedClaims: [
      'Iron contributes to the reduction of tiredness and fatigue',
      'Vitamin D contributes to the normal function of the immune system',
    ],
    flag: 'gut-general',
    placeholder: true,
  },
];

export interface OtcCatalogueGroup {
  category: OtcCategoryInfo;
  products: OtcProduct[];
}

// The flags the OTC getters read: the master switch + the enabled-category
// allowlist (parsed from OTC_CATEGORIES in cta.ts). A category renders only when
// the master is on AND it is in the allowlist.
export type OtcFlags = Pick<CtaFlags, 'otcShop' | 'otcCategories'>;

// Is a single category enabled? Master on AND the category in the allowlist.
export function isCategoryEnabled(category: OtcCategory, flags: OtcFlags): boolean {
  return flags.otcShop === true && flags.otcCategories.includes(category);
}

// The catalogue, grouped by category in display order, containing ONLY the
// enabled categories. Returns [] when the master is off — so NO OTC name / claim /
// price renders anywhere while the shop is off, and a not-yet-cleared category
// stays fully absent (not just hidden) until its flag flips.
export function getOtcCatalogue(flags: OtcFlags): OtcCatalogueGroup[] {
  if (!flags.otcShop) return [];
  return OTC_CATEGORIES.filter((c) => isCategoryEnabled(c.id, flags)).map((category) => ({
    category,
    products: OTC_PRODUCTS.filter((p) => p.category === category.id),
  }));
}

// Resolve a single OTC product under the flags. Returns null when the shop is off,
// the line's category is not enabled, or the id is unknown — so a POSTed add-to-cart
// cannot smuggle in a line whose category is off, and the surface never renders a
// leaked name. Mirrors getMenopauseProduct's flag-guarded single lookup.
export function getOtcProduct(id: string, flags: OtcFlags): OtcProduct | null {
  const product = OTC_PRODUCTS.find((p) => p.id === id);
  if (!product) return null;
  if (!isCategoryEnabled(product.category, flags)) return null;
  return product;
}

// True when an id is a real OTC product id (flag-independent structural check,
// used by cart/consistency validation).
export function isKnownOtcProductId(id: string): boolean {
  return OTC_PRODUCTS.some((p) => p.id === id);
}
