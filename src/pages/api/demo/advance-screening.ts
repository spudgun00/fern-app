import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase/admin';
import { getScreening } from '../../../lib/adapters/factory';
import {
  ensureAccount,
  getJourney,
  getLatestIntakeRef,
  getLatestScreeningRef,
} from '../../../lib/accounts';
import {
  attachScreeningResults,
  receiveScreeningSample,
  routeScreenedToConsult,
  routeScreenedToReview,
} from '../../../lib/screening/order';

// A reviewer-facing demo affordance to step the MOCK at-home screening forward
// (kit_sent -> sample_received -> results_ready) so a screening-led walk can reach
// a clinician decision on the demo, without the raw /dev harness. It mirrors
// /api/demo/advance-dispense: it lives under the ungated /api/demo/*, drives the
// SAME lib orchestration a real lab callback would (receiveScreeningSample ->
// attachScreeningResults), and steps ONE stage per POST (idempotent: a no-op once
// the bloods are in).
//
// It does NOT bypass the screening guard. It ADVANCES the screening to
// results_ready exactly as a real UKAS lab would, which is precisely what flips
// the guard from blocked to allowed. A clinician still makes every prescribing
// decision after this; nothing here reaches rx_issued. It is a mock-only stand-in
// for the lab (the real lab pushes its own status), a no-op for any non-mock impl.
//
// Once the bloods are in, it routes the screened patient to the next step:
// `?route=consult` -> the assessed consult lane (results_ready, lane full: the
// patient then pays the consult fee and books); anything else -> the async review
// queue (results_ready -> in_review_queue + a queue_item). Either way a clinician
// decides.
export const POST: APIRoute = async (ctx) => {
  const { user, env } = ctx.locals;
  if (!user) return ctx.redirect('/login');

  const admin = createAdminClient(env);
  const account = await ensureAccount(admin, user.id);

  const form = await ctx.request.formData().catch(() => null);
  const routeParam = String(
    form?.get('route') ?? ctx.url.searchParams.get('route') ?? 'review',
  );
  const ret = String(form?.get('return') ?? '/screening');
  const safeReturn = ret.startsWith('/') ? ret : '/screening';

  try {
    const ref = await getLatestScreeningRef(admin, account.id);
    if (!ref) throw new Error('No screening kit to advance for this account.');
    const journey = await getJourney(admin, account.id);
    const state = journey?.state;

    // Step ONE stage forward, matching the current journey state.
    if (state === 'screening_kit_sent') {
      await receiveScreeningSample(admin, account.id, ref.kit_ref);
    } else if (state === 'sample_received') {
      await attachScreeningResults(admin, account.id, ref.kit_ref);
      // Route the now-ready patient to the chosen next step.
      if (routeParam === 'consult') {
        await routeScreenedToConsult(admin, account.id);
      } else {
        const intake = await getLatestIntakeRef(admin, account.id);
        if (!intake) throw new Error('No intake pointer to attach the review to.');
        await routeScreenedToReview(admin, account.id, intake.intake_id);
      }
    }
    // Any other state: idempotent no-op (already advanced / not in the branch).
  } catch (err) {
    return ctx.redirect(
      safeReturn +
        '?error=' +
        encodeURIComponent(err instanceof Error ? err.message : 'Could not advance screening'),
    );
  }

  return ctx.redirect(safeReturn);
};
