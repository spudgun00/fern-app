import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase/admin';
import { ensureAccount } from '../../../lib/accounts';
import { flagsFromEnv } from '../../../lib/cta';
import { getOtcProduct } from '../../../data/otc-catalogue';
import { getProduct } from '../../../lib/checkout/products';
import { addCartItem, type CartLineType } from '../../../lib/cart/cart';

// Shop S2 — add a typed line to the unified cart. Accepts:
//   * type=otc          + productId (an OTC catalogue slug)
//   * type=prescription + productId (a treatment product descriptor id)
//
// The line's product is VALIDATED against the FLAG-GATED catalogue server-side
// before it is stored, so a stale / off / unknown line can never enter the cart
// (an OTC line whose category is off, or a treatment whose Rx flag is off, is
// rejected). Also the entry point fern-site's shop cards target for OTC lines.
//
// HARD LINE: adding a line is non-clinical. It touches NO journey state, issues no
// script, and comes nowhere near rx_issued. A prescription line is entry only; the
// clinician review (S3) is unchanged.
export const POST: APIRoute = async (ctx) => {
  const { user, env } = ctx.locals;
  if (!user) return ctx.redirect('/login');

  const flags = flagsFromEnv(env);
  // The cart lives inside the purchase funnel. Off (pre-CQC default) -> waitlist.
  if (!flags.purchaseEnabled) return ctx.redirect(flags.waitlistUrl);

  const admin = createAdminClient(env);
  const account = await ensureAccount(admin, user.id);
  if (account.role !== 'patient') return ctx.redirect('/');

  const form = await ctx.request.formData();
  const type = String(form.get('type') ?? '') as CartLineType;
  const productId = String(form.get('productId') ?? '');
  const back = String(form.get('back') ?? '/cart');

  const fail = (msg: string) =>
    ctx.redirect(`${back}${back.includes('?') ? '&' : '?'}error=` + encodeURIComponent(msg));

  if (type !== 'otc' && type !== 'prescription') return fail('Unknown item type.');

  // Validate the product resolves under the current flags (gates the OTC category /
  // the treatment Rx flag). A non-resolving id is rejected, never stored.
  const resolves =
    type === 'otc' ? getOtcProduct(productId, flags) : getProduct(productId, flags);
  if (!resolves) return fail('That item is not available.');

  try {
    await addCartItem(admin, account.id, type, productId);
    return ctx.redirect(`/cart?added=${encodeURIComponent(productId)}`);
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not add to your basket');
  }
};
