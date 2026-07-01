// ===========================================================================
// The shared screening subsystem (weight roadmap P5). ONE screening, two front
// doors. The SAME ScreeningAdapter + screening branch + guard serve both:
//   * weight lane   — eligibility + safety before a GLP script;
//   * menopause lane — the "Midlife Health Screen": a thyroid-mimic rule-out +
//     a cardiometabolic baseline. Shared panel below.
//
// HARD FRAMING RULE (NICE NG23): the menopause screen is a HEALTH SCREEN, NOT a
// diagnosis. NG23 says menopause in the over-45s is a clinical diagnosis with no
// bloods; framing here is "health screen", never "diagnose your menopause". A
// test asserts the framing copy carries no diagnostic claim.
// ===========================================================================

// The shared panel both front doors run: lipids, HbA1c, liver function, thyroid.
// FSH is CONDITIONAL (see fshIndicated) and is appended only where NICE indicates.
export const SHARED_PANEL = ['lipids', 'hba1c', 'liver', 'thyroid'] as const;
export type SharedMarker = (typeof SHARED_PANEL)[number];

export interface FshContext {
  age: number;
  hasMenopausalSymptoms: boolean;
  // A clinical suspicion of premature ovarian insufficiency (under 40).
  suspectedPOI: boolean;
}

// NICE NG23: FSH is NOT used to diagnose menopause in women 45+. It is indicated
// only for:
//   * women aged 40-45 WITH menopausal symptoms (incl. a change in cycle), and
//   * women UNDER 40 with a suspicion of premature ovarian insufficiency (POI).
// Everywhere else FSH is not indicated. This is the single source of that rule.
export function fshIndicated(ctx: FshContext): { indicated: boolean; reason: string } {
  if (ctx.age < 40 && ctx.suspectedPOI) {
    return { indicated: true, reason: 'Under 40 with suspected premature ovarian insufficiency' };
  }
  if (ctx.age >= 40 && ctx.age <= 45 && ctx.hasMenopausalSymptoms) {
    return { indicated: true, reason: 'Aged 40 to 45 with menopausal symptoms' };
  }
  return {
    indicated: false,
    reason:
      ctx.age > 45
        ? 'Aged over 45 — NICE NG23 diagnoses clinically, FSH not indicated'
        : 'FSH not indicated by NICE for this context',
  };
}

// The panel to run for a given context: the shared panel, plus FSH only where
// NICE indicates it.
export function midlifeScreenPanel(ctx: FshContext): string[] {
  const panel: string[] = [...SHARED_PANEL];
  if (fshIndicated(ctx).indicated) panel.push('fsh');
  return panel;
}

// The patient-facing framing for the Midlife Health Screen. SCREEN-FRAMED, never
// diagnostic. Kept here as the single source so the page copy and the tests agree.
export const MIDLIFE_SCREEN = {
  title: 'Your Midlife Health Screen',
  standfirst:
    'A simple at-home blood test that sets a baseline of your midlife health — the same screen behind our weight and menopause care.',
  // Deliberately screen-framed: it does NOT diagnose menopause (NICE NG23 diagnoses
  // that clinically in the over-45s). It rules out thyroid and other mimics and
  // sets a cardiometabolic baseline.
  disclaimer:
    'This is a health screen, not a diagnosis. It checks your thyroid, cholesterol, blood sugar and liver as a baseline and helps rule out other causes of how you have been feeling. A clinician reviews your results with you.',
  panelLabel: 'Cholesterol, blood sugar (HbA1c), liver function and thyroid, with a hormone test only where it is clinically indicated.',
} as const;
