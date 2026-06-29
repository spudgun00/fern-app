import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase/admin';
import { getDispensing } from '../../../lib/adapters/factory';
import { ensureAccount } from '../../../lib/accounts';
import { advanceDispensing } from '../../../lib/dispensing/dispense';

// DEV-ONLY affordance: step the logged-in patient's latest mock dispense through
// submitted -> dispatched -> delivered so the status view is walkable on the
// deployed URL. The real CloudRx pushes these transitions itself; advanceDispensing
// is a no-op for any non-mock dispensing impl. Not product.
export const POST: APIRoute = async (ctx) => {
  const { user, env } = ctx.locals;
  if (!user) return ctx.redirect('/login');

  const admin = createAdminClient(env);
  const account = await ensureAccount(admin, user.id);

  try {
    const dispensing = getDispensing(env, admin);
    await advanceDispensing(admin, dispensing, account.id, new Date().toISOString());
  } catch (err) {
    return ctx.redirect(
      '/treatment?error=' +
        encodeURIComponent(err instanceof Error ? err.message : 'Could not advance dispensing'),
    );
  }

  return ctx.redirect('/treatment');
};
