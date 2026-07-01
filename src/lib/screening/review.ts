import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScreeningAdapter, ScreeningMarker } from '../adapters/screening';
import { getLatestScreeningRef } from '../accounts';
import { screeningResultsReady } from './guard';

// ===========================================================================
// Clinician-console view of a patient's screening (weight roadmap P3). Assembles
// what the review queue / consult console need to show:
//   * whether a screening was required (a screening_ref exists),
//   * the coarse status + whether the bloods are in,
//   * whether a prescribing decision is BLOCKED (required but not results_ready),
//   * the panel itself, read from the ScreeningAdapter ONLY when the bloods are in.
//
// The panel is Article 9. It is read server-side for the clinician's display and
// NEVER copied into the app DB — same rule as reading the intake from the core.
// This loader mirrors the guard's block decision so the console can never show an
// enabled prescribing action while the guard would reject it.
// ===========================================================================

export interface ScreeningReview {
  required: boolean;
  status: string | null;
  ready: boolean;
  blocked: boolean;
  panel: ScreeningMarker[] | null;
}

export async function getScreeningReview(
  admin: SupabaseClient,
  screening: ScreeningAdapter,
  accountId: string,
): Promise<ScreeningReview> {
  const ref = await getLatestScreeningRef(admin, accountId);
  if (!ref) {
    // Not a screening patient (e.g. the menopause fast lane): nothing to show,
    // nothing to block.
    return { required: false, status: null, ready: false, blocked: false, panel: null };
  }
  const ready = screeningResultsReady(ref);
  let panel: ScreeningMarker[] | null = null;
  if (ready) {
    const results = await screening.getResults(ref.kit_ref);
    panel = results?.panel ?? [];
  }
  return { required: true, status: ref.status, ready, blocked: !ready, panel };
}
