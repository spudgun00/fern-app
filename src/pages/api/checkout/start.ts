import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase/admin';
import { getPayments } from '../../../lib/adapters/factory';
import { ensureAccount } from '../../../lib/accounts';
import { flagsFromEnv } from '../../../lib/cta';
import { getProduct } from '../../../lib/checkout/products';
import { startProductCheckout } from '../../../lib/checkout/checkout';

// Checkout C2: start a one-off pay-first checkout for a product descriptor
// (journey A menopause screen / journey B weight treatment). Thin: the flags gate,
// the consent requirement, and the pending-pointer + consent record all live in
// the switch (flagsFromEnv / getProduct) and startTreatmentCheckout.
//
// HARD LINE: with the purchase funnel off (pre-CQC default) there is no checkout —
// the entry CTAs are the waitlist. With weightLossRx off the weight product does
// not resolve, so no assessment/treatment checkout can be started for it.
export const POST: APIRoute = async (ctx) => {
  const { user, env } = ctx.locals;
  if (!user) return ctx.redirect('/login');

  const admin = createAdminClient(env);
  const account = await ensureAccount(admin, user.id);
  if (account.role !== 'patient') return ctx.redirect('/');

  const flags = flagsFromEnv(env);
  if (!flags.purchaseEnabled) return ctx.redirect(flags.waitlistUrl);

  const form = await ctx.request.formData();
  const productId = String(form.get('product') ?? '');
  const consent = form.get('consent');

  const product = getProduct(productId, flags);
  if (!product) return ctx.redirect('/checkout?error=' + encodeURIComponent('That option is not available.'));

  // Consent is mandatory at checkout (waitlist discipline), enforced server-side.
  if (consent !== 'on' && consent !== 'true') {
    return ctx.redirect(
      `/checkout?product=${product.id}&error=` +
        encodeURIComponent('Please confirm you consent to continue.'),
    );
  }

  try {
    const returnUrl = new URL(`/checkout/complete?product=${product.id}`, ctx.url).toString();
    const payments = getPayments(env, admin);
    const clientUrl = await startProductCheckout(admin, payments, product, account.id, returnUrl);
    return ctx.redirect(clientUrl);
  } catch (err) {
    return ctx.redirect(
      `/checkout?product=${product.id}&error=` +
        encodeURIComponent(err instanceof Error ? err.message : 'Could not start checkout'),
    );
  }
};
