import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase/admin';
import { ensureAccount } from '../../../lib/accounts';
import { flagsFromEnv } from '../../../lib/cta';
import { removeCartItem } from '../../../lib/cart/cart';

// Shop S2 — remove a line from the unified cart by its id (scoped to the account).
// Non-clinical; touches no journey state.
export const POST: APIRoute = async (ctx) => {
  const { user, env } = ctx.locals;
  if (!user) return ctx.redirect('/login');

  const flags = flagsFromEnv(env);
  if (!flags.purchaseEnabled) return ctx.redirect(flags.waitlistUrl);

  const admin = createAdminClient(env);
  const account = await ensureAccount(admin, user.id);
  if (account.role !== 'patient') return ctx.redirect('/');

  const form = await ctx.request.formData();
  const lineId = String(form.get('lineId') ?? '');
  if (lineId) {
    try {
      await removeCartItem(admin, account.id, lineId);
    } catch {
      // Non-fatal: fall through to re-render the cart.
    }
  }
  return ctx.redirect('/cart');
};
