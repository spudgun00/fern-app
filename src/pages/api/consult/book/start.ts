import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../../lib/supabase/admin';
import { getBooking } from '../../../../lib/adapters/factory';
import { ensureAccount } from '../../../../lib/accounts';
import { startConsultBooking } from '../../../../lib/consult/booking';

// Starts a consult booking session (mock or Cal.com, per BOOKING_IMPL). The gate
// (consult fee paid + a bookable full-lane state) and the pending pointer are
// enforced in startConsultBooking; the route is thin. Redirects to the
// provider/mock hosted booking page where the patient picks a slot.
export const POST: APIRoute = async (ctx) => {
  const { user, env } = ctx.locals;
  if (!user) return ctx.redirect('/login');

  const admin = createAdminClient(env);
  const account = await ensureAccount(admin, user.id);
  if (account.role !== 'patient') return ctx.redirect('/');

  try {
    const returnUrl = new URL('/consult/book/complete', ctx.url).toString();
    const booking = getBooking(env, admin);
    const clientUrl = await startConsultBooking(admin, booking, account.id, returnUrl);
    return ctx.redirect(clientUrl);
  } catch (err) {
    return ctx.redirect(
      '/consult?error=' +
        encodeURIComponent(err instanceof Error ? err.message : 'Could not start booking'),
    );
  }
};
