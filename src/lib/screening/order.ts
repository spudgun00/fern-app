import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScreeningAdapter } from '../adapters/screening';
import {
  advanceJourney,
  getJourney,
  insertFastQueueItem,
  recordScreeningRef,
  setJourney,
  setScreeningRefStatus,
  type ScreeningRefStatus,
} from '../accounts';
import type { GlpInitiationRoute } from '../weight/glp-routing';

// ===========================================================================
// Screening orchestration (weight roadmap P2). The single place the at-home
// blood-test branch is driven. Each step: call the ScreeningAdapter (the panel /
// clinical content lives ONLY behind it), advance the journey through the legal
// transitions, and mirror a coarse status onto the app-DB screening_ref pointer.
//
// HARD LINE: nothing here reaches a prescribing state. The furthest the branch
// goes is results_ready -> in_review_queue (a clinician picks it up in P3, and
// only once the guard passes). No path auto-approves or auto-issues a script.
// ===========================================================================

// The menopause front door into the SAME screening subsystem (weight roadmap P5).
// The Midlife Health Screen is not a separate flow: it is orderScreeningKit under
// screen-framed copy (see screening/panel.ts MIDLIFE_SCREEN). Both front doors —
// weight (submitWeightIntake) and menopause (here) — order the same kit, walk the
// same branch (screening_kit_sent -> sample_received -> results_ready), and hit the
// same guard before a clinician decides. One screening, two doors.
export async function startMidlifeScreen(
  admin: SupabaseClient,
  screening: ScreeningAdapter,
  accountId: string,
  corePatientId: string,
): Promise<string> {
  return orderScreeningKit(admin, screening, accountId, corePatientId);
}

// Order the kit. Precondition: the journey is at intake_submitted (post-intake).
// intake_submitted -> screening_kit_sent; writes the screening_ref pointer.
export async function orderScreeningKit(
  admin: SupabaseClient,
  screening: ScreeningAdapter,
  accountId: string,
  corePatientId: string,
): Promise<string> {
  const kitRef = await screening.orderKit(corePatientId);
  await advanceJourney(admin, accountId, 'screening_kit_sent');
  await recordScreeningRef(admin, accountId, kitRef, 'kit_sent');
  return kitRef;
}

// The lab received the sample. screening_kit_sent -> sample_received.
export async function receiveScreeningSample(
  admin: SupabaseClient,
  accountId: string,
  kitRef: string,
): Promise<void> {
  await advanceJourney(admin, accountId, 'sample_received');
  await setScreeningRefStatus(admin, kitRef, 'sample_received');
}

// The bloods reported. sample_received -> results_ready. This flips the guard:
// from here a clinician may take the decision (the results ride in the core /
// behind the adapter for review). The results themselves are never copied here.
export async function attachScreeningResults(
  admin: SupabaseClient,
  accountId: string,
  kitRef: string,
): Promise<void> {
  await advanceJourney(admin, accountId, 'results_ready');
  await setScreeningRefStatus(admin, kitRef, 'results_ready');
}

// Once the bloods are in, route into the async clinician review queue with the
// screening attached: results_ready -> in_review_queue + a fast-lane queue_item
// pointer (the same pointer intake / repeat use). The full-lane (consult) route
// is P6/full-lane territory; this phase drives the async review path.
export async function routeScreenedToReview(
  admin: SupabaseClient,
  accountId: string,
  intakeId: string,
): Promise<string> {
  const journey = await getJourney(admin, accountId);
  if (journey?.state !== 'results_ready') {
    throw new Error(
      `routeScreenedToReview: patient bloods are not in (state ${journey?.state ?? 'none'})`,
    );
  }
  await advanceJourney(admin, accountId, 'in_review_queue', 'fast');
  return insertFastQueueItem(admin, accountId, intakeId);
}

// C3 — the consult branch of the GLP initiation switch. A screened weight patient
// whose bloods are in is routed to the ASSESSED lane instead of the async queue:
// the journey stays at results_ready with lane 'full', so the patient then pays
// the consult fee (Journey C) and books (results_ready -> consult_booked). No
// queue_item is created (this is not an async review). Nothing here prescribes.
export async function routeScreenedToConsult(
  admin: SupabaseClient,
  accountId: string,
): Promise<void> {
  const journey = await getJourney(admin, accountId);
  if (journey?.state !== 'results_ready') {
    throw new Error(
      `routeScreenedToConsult: patient bloods are not in (state ${journey?.state ?? 'none'})`,
    );
  }
  // Mark the assessed lane; the state stays results_ready until a slot is booked.
  await setJourney(admin, accountId, 'results_ready', 'full');
}

// C3 — the GLP initiation routing switch, applied. Given the route chosen by
// glpInitiationRoute (async | consult), send a screened patient down the async
// review queue OR the assessed consult lane, WITHOUT a rewrite: one dispatcher,
// the same two legal machine edges out of results_ready. The async default is the
// existing behaviour, unchanged. Either lane still ends at a clinician decision.
export async function routeScreenedWeightPatient(
  admin: SupabaseClient,
  accountId: string,
  intakeId: string,
  route: GlpInitiationRoute,
): Promise<{ route: GlpInitiationRoute; queueItemId: string | null }> {
  if (route === 'consult') {
    await routeScreenedToConsult(admin, accountId);
    return { route, queueItemId: null };
  }
  const queueItemId = await routeScreenedToReview(admin, accountId, intakeId);
  return { route, queueItemId };
}

// Small convenience for callers/tests that step the mock status label.
export const SCREENING_STATUSES: readonly ScreeningRefStatus[] = [
  'kit_sent',
  'sample_received',
  'results_ready',
];
