import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase/admin';
import { authedLandingPath } from '../../../lib/landing';

// Email + password log-in. Sets the cookie session and ensures an account +
// journey row exist (covers users created out-of-band, e.g. a clinician seeded
// directly in the DB).
export const POST: APIRoute = async (ctx) => {
  const form = await ctx.request.formData();
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');

  if (!email || !password) {
    return ctx.redirect('/login?error=' + encodeURIComponent('Email and password are required'));
  }

  const { error } = await ctx.locals.supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return ctx.redirect('/login?error=' + encodeURIComponent(error.message));
  }

  const {
    data: { user },
  } = await ctx.locals.supabase.auth.getUser();
  if (!user) {
    return ctx.redirect('/login?error=' + encodeURIComponent('Log-in failed, please try again'));
  }

  // Land the patient at their current journey step (or the clinician console),
  // never the P0 dev harness.
  const dest = await authedLandingPath(createAdminClient(ctx.locals.env), user.id);
  return ctx.redirect(dest);
};
