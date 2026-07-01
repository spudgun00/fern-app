import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScreeningAdapter } from '../adapters/screening';
import {
  advanceJourney,
  getJourney,
  insertFastQueueItem,
  recordScreeningRef,
  setScreeningRefStatus,
  type ScreeningRefStatus,
} from '../accounts';

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

// Small convenience for callers/tests that step the mock status label.
export const SCREENING_STATUSES: readonly ScreeningRefStatus[] = [
  'kit_sent',
  'sample_received',
  'results_ready',
];
