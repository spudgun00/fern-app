import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase/admin';
import { getDispensing } from '../../../lib/adapters/factory';
import { ensureAccount } from '../../../lib/accounts';
import { advanceDispensing } from '../../../lib/dispensing/dispense';

// Phase F — the reviewer-facing demo affordance to step the MOCK dispensing
// forward (submitted -> dispatched -> delivered) so a reviewer can watch the loop
// finish to "Delivered" on the patient view, without the raw /dev harness (which
// is DEV_TOOLS-gated and hidden in the demo). This lives under /api/demo/* (NOT
// gated by DEV_TOOLS) alongside the other reviewer demo controls.
//
// It NEVER touches the hard line: advanceDispensing only walks dispensing ->
// delivered (a downstream fulfilment step); it never reaches rx_issued, and it is
// a no-op for any non-mock dispensing impl (the real CloudRx pushes its own
// status). Same lib function the dev harness uses.
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
