import type { APIRoute } from 'astro';
import { createAdminClient } from '../lib/supabase/admin';
import { ensureAccount, getJourney } from '../lib/accounts';
import { flagsFromEnv } from '../lib/cta';
import { startDestination } from '../lib/start';

// Phase C — the canonical site->app entry. The marketing site's Start CTA points
// here (https://app.fern.care/start). It must work hit DIRECTLY with no prior
// session: a cold visitor begins account creation; a returning visitor resumes.
//
// GET-only, no body, pure redirect (the resolver is startDestination). No CSRF
// concern (GET). No dead end: every branch redirects somewhere real.
export const GET: APIRoute = async (ctx) => {
  const { user, env } = ctx.locals;
  const flags = flagsFromEnv(env);

  // Purchase off, or no session (a cold visitor from the site): resolve without a
  // DB read. A cold visitor -> account creation; purchase off -> the waitlist.
  if (!flags.purchaseEnabled || !user) {
    return ctx.redirect(startDestination(flags, { hasSession: false }));
  }

  // Signed in: resume at the current onboarding step (never a mid-flow drop).
  const admin = createAdminClient(env);
  const account = await ensureAccount(admin, user.id);
  const journey = await getJourney(admin, account.id);
  return ctx.redirect(
    startDestination(flags, {
      hasSession: true,
      role: account.role,
      state: journey?.state ?? null,
    }),
  );
};
