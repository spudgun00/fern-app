import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../../lib/supabase/admin';
import { getIdentity } from '../../../../lib/adapters/factory';
import { MockIdentity } from '../../../../lib/adapters/mock-identity';

// Mock-only: simulates the user completing the provider hosted flow and the
// provider deciding "verified". Guarded to the mock impl; the journey advance
// itself happens on the return page (/account/verify/complete) via
// finaliseVerification, exactly as the Stripe path does.
export const POST: APIRoute = async (ctx) => {
  const { user, env } = ctx.locals;
  if (!user) return ctx.redirect('/login');

  const form = await ctx.request.formData();
  const session = String(form.get('session') ?? '');
  const ret = String(form.get('return') ?? '/account/verify/complete');

  const admin = createAdminClient(env);
  const identity = getIdentity(env, admin);
  if (!(identity instanceof MockIdentity)) {
    return ctx.redirect('/account/verify?error=' + encodeURIComponent('Mock flow disabled'));
  }
  if (session) await identity.markVerified(session);

  return ctx.redirect(ret);
};
