import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../../lib/supabase/admin';
import { getBooking } from '../../../../lib/adapters/factory';
import { MockBooking } from '../../../../lib/adapters/mock-booking';

// Mock-only: simulates the user picking a slot on the provider hosted page and
// the provider confirming the booking. Guarded to the mock impl; the app-side
// finalisation (create the video room, flip the pointer to booked, advance the
// journey to consult_booked) then happens on the return page
// (/consult/book/complete) via finaliseLatestBooking, exactly as the real Cal.com
// path is finalised by the webhook + the return poll.
export const POST: APIRoute = async (ctx) => {
  const { user, env } = ctx.locals;
  if (!user) return ctx.redirect('/login');

  const form = await ctx.request.formData();
  const booking = String(form.get('booking') ?? '');
  const slot = String(form.get('slot') ?? '');
  const ret = String(form.get('return') ?? '/consult/book/complete');

  const admin = createAdminClient(env);
  const bookingAdapter = getBooking(env, admin);
  if (!(bookingAdapter instanceof MockBooking)) {
    return ctx.redirect('/consult?error=' + encodeURIComponent('Mock booking disabled'));
  }
  if (booking && slot) await bookingAdapter.markBooked(booking, slot);

  return ctx.redirect(ret);
};
