import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase/admin';
import { getPayments } from '../../../lib/adapters/factory';
import { ensureAccount, getMembership } from '../../../lib/accounts';

// Opens the provider billing portal (Stripe customer portal, or the in-app mock
// portal) so the member can manage / cancel their subscription. Maps the account
// to its provider customer pointer; a cancel taken there flips membership state
// (via the webhook for Stripe, or the mock-portal-cancel route for the mock).
export const POST: APIRoute = async (ctx) => {
  const { user, env } = ctx.locals;
  if (!user) return ctx.redirect('/login');

  const admin = createAdminClient(env);
  const account = await ensureAccount(admin, user.id);
  if (account.role !== 'patient') return ctx.redirect('/');

  const membership = await getMembership(admin, account.id);
  if (!membership?.provider_customer_ref) {
    return ctx.redirect(
      '/account/billing?error=' + encodeURIComponent('No membership to manage yet'),
    );
  }

  try {
    const returnUrl = new URL('/account/billing', ctx.url).toString();
    const payments = getPayments(env, admin);
    const session = await payments.createPortalSession(
      membership.provider_customer_ref,
      returnUrl,
    );
    return ctx.redirect(session.portalUrl);
  } catch (err) {
    return ctx.redirect(
      '/account/billing?error=' +
        encodeURIComponent(err instanceof Error ? err.message : 'Could not open the billing portal'),
    );
  }
};
