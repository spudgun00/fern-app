import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase/admin';
import { getClinicalCore } from '../../../lib/adapters/factory';
import { ensureAccount } from '../../../lib/accounts';
import { lodgeRepeatRequest } from '../../../lib/dispensing/dispense';

// P4 — a patient lodges a repeat request for their last script. It writes a
// repeat request to the core and enters the clinician review queue (a fresh
// pending fast-lane item). Patient-gated; the clinician still reviews every
// repeat (the hard line holds: no repeat auto-issues a script).
export const POST: APIRoute = async (ctx) => {
  const { user, env } = ctx.locals;
  if (!user) return ctx.redirect('/login');

  const admin = createAdminClient(env);
  const account = await ensureAccount(admin, user.id);
  if (account.role !== 'patient' || !account.core_patient_id) return ctx.redirect('/');

  try {
    const core = getClinicalCore(env, admin);
    await lodgeRepeatRequest(admin, core, account.id, account.core_patient_id);
  } catch (err) {
    return ctx.redirect(
      '/treatment?error=' +
        encodeURIComponent(err instanceof Error ? err.message : 'Could not lodge the repeat request'),
    );
  }

  return ctx.redirect(
    '/treatment?notice=' +
      encodeURIComponent('Repeat request lodged. A clinician will review it before it is dispensed.'),
  );
};
