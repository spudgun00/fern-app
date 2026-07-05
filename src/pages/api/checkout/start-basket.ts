import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase/admin';
import { getPayments } from '../../../lib/adapters/factory';
import { ensureAccount } from '../../../lib/accounts';
import { flagsFromEnv } from '../../../lib/cta';
import { getResolvedCart } from '../../../lib/cart/cart';
import { startBasketCheckout } from '../../../lib/checkout/basket';

// Shop S3 — start the single payment for the whole basket. Thin: the flags gate,
// the per-prescription-line consent requirement, and the basket-session + consent
// records live in startBasketCheckout.
//
// HARD LINE: with the purchase funnel off there is no checkout (waitlist). The
// basket payment gates OTC fulfilment + entry to the prescription journey only; it
// never reaches rx_issued.
export const POST: APIRoute = async (ctx) => {
  const { user, env } = ctx.locals;
  if (!user) return ctx.redirect('/login');

  const flags = flagsFromEnv(env);
  if (!flags.purchaseEnabled) return ctx.redirect(flags.waitlistUrl);

  const admin = createAdminClient(env);
  const account = await ensureAccount(admin, user.id);
  if (account.role !== 'patient') return ctx.redirect('/');

  const cart = await getResolvedCart(admin, account.id, flags);
  if (cart.count === 0) {
    return ctx.redirect('/cart?error=' + encodeURIComponent('Your basket is empty.'));
  }

  // Clinical consent is mandatory for a basket that contains a prescription line
  // (OTC needs none), enforced server-side.
  if (cart.hasPrescription) {
    const consent = (await ctx.request.formData()).get('consent');
    if (consent !== 'on' && consent !== 'true') {
      return ctx.redirect('/checkout?error=' + encodeURIComponent('Please confirm you consent to continue.'));
    }
  }

  try {
    const returnUrl = new URL('/checkout/complete?basket=1', ctx.url).toString();
    const payments = getPayments(env, admin);
    const clientUrl = await startBasketCheckout(admin, payments, account.id, flags, returnUrl);
    return ctx.redirect(clientUrl);
  } catch (err) {
    return ctx.redirect(
      '/checkout?error=' + encodeURIComponent(err instanceof Error ? err.message : 'Could not start checkout'),
    );
  }
};
