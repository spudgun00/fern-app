import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../../lib/supabase/admin';
import { getPayments } from '../../../../lib/adapters/factory';
import { ensureAccount } from '../../../../lib/accounts';
import { startCheckout } from '../../../../lib/payments/billing';
import type { CheckoutKind } from '../../../../lib/adapters/payments';

// Starts a Stripe Checkout session (mock or Stripe, per PAYMENTS_IMPL) for the
// consult fee or the membership, records the pending session pointer, then
// redirects to the provider/mock hosted checkout. The card is taken by the
// provider; the app DB only ever sees the session pointer + status.
export const POST: APIRoute = async (ctx) => {
  const { user, env } = ctx.locals;
  if (!user) return ctx.redirect('/login');

  const admin = createAdminClient(env);
  const account = await ensureAccount(admin, user.id);
  if (account.role !== 'patient') return ctx.redirect('/');

  const form = await ctx.request.formData();
  const kind = String(form.get('kind') ?? '') as CheckoutKind;
  if (kind !== 'consult' && kind !== 'membership') {
    return ctx.redirect('/account/billing?error=' + encodeURIComponent('Unknown payment kind'));
  }

  try {
    const returnUrl = new URL('/account/billing/complete', ctx.url).toString();
    const payments = getPayments(env, admin);
    const clientUrl = await startCheckout(admin, payments, kind, account.id, returnUrl);
    return ctx.redirect(clientUrl);
  } catch (err) {
    return ctx.redirect(
      '/account/billing?error=' +
        encodeURIComponent(err instanceof Error ? err.message : 'Could not start checkout'),
    );
  }
};
