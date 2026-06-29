import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase/admin';
import { getPayments } from '../../../lib/adapters/factory';
import { MockPayments } from '../../../lib/adapters/mock-payments';

// Mock-only: simulates the user completing the provider hosted checkout and the
// provider marking it paid. Guarded to the mock impl; the app-side finalisation
// (mark the payment paid / activate membership / advance to active_member) then
// happens on the return page (/account/billing/complete) via finaliseLatestPending,
// exactly as the real Stripe path is finalised by the webhook + the return poll.
export const POST: APIRoute = async (ctx) => {
  const { user, env } = ctx.locals;
  if (!user) return ctx.redirect('/login');

  const form = await ctx.request.formData();
  const session = String(form.get('session') ?? '');
  const ret = String(form.get('return') ?? '/account/billing/complete');

  const admin = createAdminClient(env);
  const payments = getPayments(env, admin);
  if (!(payments instanceof MockPayments)) {
    return ctx.redirect('/account/billing?error=' + encodeURIComponent('Mock checkout disabled'));
  }
  if (session) await payments.markPaid(session);

  return ctx.redirect(ret);
};
