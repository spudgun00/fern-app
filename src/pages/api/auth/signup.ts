import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase/admin';
import { ensureAccount } from '../../../lib/accounts';

// Email + password sign-up. For this dev phase email confirmation is bypassed:
// the user is created confirmed via the admin API, an account row (default role
// 'patient') + journey row are created, then the user is signed in to set the
// cookie session.
export const POST: APIRoute = async (ctx) => {
  const form = await ctx.request.formData();
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');

  if (!email || !password) {
    return ctx.redirect('/signup?error=' + encodeURIComponent('Email and password are required'));
  }

  const env = ctx.locals.env;
  const admin = createAdminClient(env);

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !created.user) {
    return ctx.redirect('/signup?error=' + encodeURIComponent(error?.message ?? 'Sign-up failed'));
  }

  await ensureAccount(admin, created.user.id);

  const { error: signInErr } = await ctx.locals.supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (signInErr) {
    return ctx.redirect('/login?error=' + encodeURIComponent(signInErr.message));
  }

  // P1 onboarding starts at the profile step.
  return ctx.redirect('/account/profile');
};
