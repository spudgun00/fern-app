import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../../lib/supabase/admin';
import { getIdentity } from '../../../../lib/adapters/factory';
import {
  advanceJourney,
  ensureAccount,
  getJourney,
  recordIdVerification,
} from '../../../../lib/accounts';

// Starts an identity-verification session via the IdentityAdapter (mock or
// Stripe, per IDENTITY_IMPL), records the provider pointer (provider_ref +
// status only), moves the journey registered -> id_pending if not already
// there, then redirects to the provider/mock hosted flow.
export const POST: APIRoute = async (ctx) => {
  const { user, env } = ctx.locals;
  if (!user) return ctx.redirect('/login');

  const admin = createAdminClient(env);
  const account = await ensureAccount(admin, user.id);

  if (!account.core_patient_id) return ctx.redirect('/account/profile');

  try {
    const journey = await getJourney(admin, account.id);
    if (journey?.state === 'registered') {
      await advanceJourney(admin, account.id, 'id_pending');
    }

    const returnUrl = new URL('/account/verify/complete', ctx.url).toString();
    const identity = getIdentity(env, admin);
    const session = await identity.createVerificationSession(account.id, returnUrl);

    // App DB stores the pointer + status only. No document images, no PII.
    await recordIdVerification(admin, account.id, session.sessionId, 'requires_input');

    return ctx.redirect(session.clientUrl);
  } catch (err) {
    return ctx.redirect(
      '/account/verify?error=' +
        encodeURIComponent(err instanceof Error ? err.message : 'Could not start the ID check'),
    );
  }
};
