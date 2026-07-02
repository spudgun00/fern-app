// ===========================================================================
// Checkout C6 — the menopause HRT catalogue. The prescribable menopause products
// (types, routes, forms) as STRUCTURED DATA the treatment step reads from, the
// HRT equivalent of the weight drug layer. NICE NG23 / BMS-aligned categories.
//
// HARD LINES baked in here:
//   * This is a catalogue of TREATMENT TYPES, not a prescription. Rendering a
//     product is not issuing it. A clinician still writes every script; choosing
//     a product here is a PREFERENCE only (src/lib/menopause/treatment.ts).
//   * The whole catalogue is gated behind menopauseRx (mirrors weightLossRx). The
//     getters return [] / null when it is off, so NO HRT product name or type
//     renders anywhere while the flag is off. The strings live here but are only
//     ever read behind the flag; the treatment step shows the labelled C6
//     placeholder instead when it is off.
//   * clinicianName and the patient-facing fields are SEPARATE fields: the
//     console shows the precise clinician-facing name; the patient sees a plain
//     label + description. They never share a field.
//
// Names are category / class level (the real prescribable menopause categories),
// aligned to NICE NG23 and BMS guidance. Transdermal oestrogen is the guideline-
// preferred route (lower VTE risk); women with a uterus need endometrial
// protection (a progestogen) alongside systemic oestrogen; local vaginal
// oestrogen treats urogenital symptoms; testosterone is specialist-initiated,
// off-label, for persistent low sexual desire. The clinician selects the exact
// product, dose and regimen — this catalogue frames the options.
// ===========================================================================
import type { CtaFlags } from '../cta';

export type HrtCategory =
  | 'systemic-oestrogen'
  | 'progestogen'
  | 'combined'
  | 'vaginal-oestrogen'
  | 'testosterone';

export interface HrtCategoryInfo {
  id: HrtCategory;
  // Patient-facing heading for the group.
  title: string;
  // Patient-facing one-line description of what this group is for.
  blurb: string;
  // The NICE NG23 / BMS note that anchors this category (shown to the clinician /
  // in the governance surface, not a marketing claim).
  guidelineNote: string;
}

export interface HrtProduct {
  id: string;
  category: HrtCategory;
  // CLINICIAN-FACING precise name (the console + the clinical record use this).
  // Class / category level; the clinician sets the exact product, dose, regimen.
  clinicianName: string;
  // PATIENT-FACING short label (what the patient sees on the selection tile).
  patientName: string;
  // PATIENT-FACING plain description (what it is + how it is taken). No dose, no
  // outcome or efficacy claim, no brand.
  patientDescription: string;
  // Route + form, structured so the surface can group / filter without parsing.
  route: 'transdermal' | 'oral' | 'vaginal' | 'intrauterine';
  form: string;
  // True when this product provides (or requires alongside it) endometrial
  // protection. Guidance for the clinician; the patient copy stays plain.
  endometrialProtection: 'provides' | 'requires-progestogen' | 'not-applicable';
  // Specialist-initiated / off-label (testosterone). Surfaced as a note so a
  // patient cannot self-select it as a routine option.
  specialistOnly?: boolean;
}

export const HRT_CATEGORIES: HrtCategoryInfo[] = [
  {
    id: 'systemic-oestrogen',
    title: 'Oestrogen (body-wide)',
    blurb: 'Replaces the oestrogen your body makes less of, to ease menopause symptoms.',
    guidelineNote:
      'NICE NG23: transdermal oestrogen is preferred where clot (VTE) risk is a factor. A woman with a uterus also needs a progestogen for endometrial protection.',
  },
  {
    id: 'progestogen',
    title: 'Progestogen (womb protection)',
    blurb: 'Protects the lining of the womb when you take body-wide oestrogen.',
    guidelineNote:
      'NICE NG23 / BMS: endometrial protection is required for a woman with a uterus on systemic oestrogen. Micronised progesterone is the body-identical option.',
  },
  {
    id: 'combined',
    title: 'Combined (oestrogen and progestogen together)',
    blurb: 'One option that provides both the oestrogen and the womb protection.',
    guidelineNote:
      'BMS: sequential regimens suit perimenopause (still having periods); continuous combined suits post-menopause. The clinician sets the regimen.',
  },
  {
    id: 'vaginal-oestrogen',
    title: 'Vaginal (local) oestrogen',
    blurb: 'A low-dose local treatment for vaginal dryness and urinary symptoms.',
    guidelineNote:
      'NICE NG23: local vaginal oestrogen can be used alone for urogenital symptoms and does not require a progestogen; it can also be added to systemic HRT.',
  },
  {
    id: 'testosterone',
    title: 'Testosterone',
    blurb: 'Considered where low sexual desire persists after other HRT.',
    guidelineNote:
      'NICE NG23 / BMS: testosterone is off-label for menopause and specialist-initiated, considered for persistent low sexual desire when HRT alone has not helped.',
  },
];

// The prescribable products. Category / class level; the clinician picks the
// exact product, strength and regimen at the point of prescribing.
export const HRT_PRODUCTS: HrtProduct[] = [
  // --- Systemic oestrogen (transdermal preferred per NICE NG23) ---
  {
    id: 'estradiol-patch',
    category: 'systemic-oestrogen',
    clinicianName: 'Transdermal estradiol patch',
    patientName: 'Oestrogen skin patch',
    patientDescription:
      'A small patch you stick on your skin and change a couple of times a week. It releases oestrogen through the skin.',
    route: 'transdermal',
    form: 'patch',
    endometrialProtection: 'requires-progestogen',
  },
  {
    id: 'estradiol-gel',
    category: 'systemic-oestrogen',
    clinicianName: 'Transdermal estradiol gel',
    patientName: 'Oestrogen gel',
    patientDescription:
      'A gel you rub into your skin once a day. The oestrogen is absorbed through the skin.',
    route: 'transdermal',
    form: 'gel',
    endometrialProtection: 'requires-progestogen',
  },
  {
    id: 'estradiol-spray',
    category: 'systemic-oestrogen',
    clinicianName: 'Transdermal estradiol spray',
    patientName: 'Oestrogen spray',
    patientDescription:
      'A spray you apply to your skin once a day. The oestrogen is absorbed through the skin.',
    route: 'transdermal',
    form: 'spray',
    endometrialProtection: 'requires-progestogen',
  },
  {
    id: 'estradiol-tablet',
    category: 'systemic-oestrogen',
    clinicianName: 'Oral estradiol tablet',
    patientName: 'Oestrogen tablet',
    patientDescription: 'A tablet you take by mouth once a day.',
    route: 'oral',
    form: 'tablet',
    endometrialProtection: 'requires-progestogen',
  },
  // --- Progestogen (endometrial protection) ---
  {
    id: 'micronised-progesterone',
    category: 'progestogen',
    clinicianName: 'Micronised progesterone (oral)',
    patientName: 'Body-identical progesterone capsule',
    patientDescription:
      'A capsule you take by mouth, usually at night. It protects the lining of your womb when you take oestrogen.',
    route: 'oral',
    form: 'capsule',
    endometrialProtection: 'provides',
  },
  {
    id: 'lng-ius',
    category: 'progestogen',
    clinicianName: 'Levonorgestrel intrauterine system (IUS)',
    patientName: 'Hormone coil (IUS)',
    patientDescription:
      'A small device a clinician places in your womb. It protects the womb lining and also works as contraception.',
    route: 'intrauterine',
    form: 'intrauterine system',
    endometrialProtection: 'provides',
  },
  // --- Combined (oestrogen + progestogen in one) ---
  {
    id: 'combined-patch',
    category: 'combined',
    clinicianName: 'Combined estradiol / progestogen patch',
    patientName: 'Combined skin patch',
    patientDescription:
      'A single patch that contains both the oestrogen and the progestogen, changed a couple of times a week.',
    route: 'transdermal',
    form: 'patch',
    endometrialProtection: 'provides',
  },
  {
    id: 'combined-tablet',
    category: 'combined',
    clinicianName: 'Combined estradiol / progestogen tablet',
    patientName: 'Combined tablet',
    patientDescription:
      'A single tablet taken by mouth that contains both the oestrogen and the progestogen.',
    route: 'oral',
    form: 'tablet',
    endometrialProtection: 'provides',
  },
  // --- Vaginal (local) oestrogen ---
  {
    id: 'vaginal-oestrogen-cream',
    category: 'vaginal-oestrogen',
    clinicianName: 'Vaginal oestrogen (cream / pessary / ring)',
    patientName: 'Vaginal oestrogen',
    patientDescription:
      'A low-dose cream, pessary or ring used locally to ease vaginal dryness and urinary symptoms. It works where you apply it.',
    route: 'vaginal',
    form: 'cream / pessary / ring',
    endometrialProtection: 'not-applicable',
  },
  // --- Testosterone (specialist-initiated, off-label) ---
  {
    id: 'testosterone-gel',
    category: 'testosterone',
    clinicianName: 'Testosterone gel (specialist-initiated, off-label)',
    patientName: 'Testosterone gel',
    patientDescription:
      'A gel considered where low sexual desire continues after other HRT. It is started and monitored by a specialist.',
    route: 'transdermal',
    form: 'gel',
    endometrialProtection: 'not-applicable',
    specialistOnly: true,
  },
];

export interface HrtCatalogueGroup {
  category: HrtCategoryInfo;
  products: HrtProduct[];
}

// The catalogue, grouped by category in display order. Returns [] when
// menopauseRx is OFF, so NO HRT name renders anywhere while the flag is off.
export function getMenopauseCatalogue(
  flags: Pick<CtaFlags, 'menopauseRx'>,
): HrtCatalogueGroup[] {
  if (!flags.menopauseRx) return [];
  return HRT_CATEGORIES.map((category) => ({
    category,
    products: HRT_PRODUCTS.filter((p) => p.category === category.id),
  }));
}

// Resolve a single product under the flag. Returns null when menopauseRx is off
// or the id is unknown — so a POSTed selection cannot smuggle a product in while
// the flag is off, and the surface never renders an unknown/leaked name.
export function getMenopauseProduct(
  id: string,
  flags: Pick<CtaFlags, 'menopauseRx'>,
): HrtProduct | null {
  if (!flags.menopauseRx) return null;
  return HRT_PRODUCTS.find((p) => p.id === id) ?? null;
}

// True when an id is a real catalogue product id (flag-independent structural
// check, used by the pure treatment-intake validation).
export function isKnownProductId(id: string): boolean {
  return HRT_PRODUCTS.some((p) => p.id === id);
}
