import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase/admin';
import { ensureAccount } from '../../../lib/accounts';

// DEV-ONLY affordance: flip the logged-in account between 'patient' and
// 'clinician' so the P3 clinician console is walkable on the deployed URL
// without seeding a clinician directly in the DB. This is dev tooling, like the
// harness / run-scenario, not product. In production a clinician is provisioned
// out-of-band (the login route already supports an out-of-band clinician).
export const POST: APIRoute = async (ctx) => {
  const { user, env } = ctx.locals;
  if (!user) return ctx.redirect('/login');

  const admin = createAdminClient(env);
  const account = await ensureAccount(admin, user.id);

  const form = await ctx.request.formData();
  const role = String(form.get('role') ?? '');
  if (role !== 'patient' && role !== 'clinician') {
    return ctx.redirect('/dev/harness');
  }

  const { error } = await admin.from('account').update({ role }).eq('id', account.id);
  if (error) {
    return ctx.redirect('/dev/harness?error=' + encodeURIComponent(error.message));
  }

  return ctx.redirect(role === 'clinician' ? '/clinician' : '/dev/harness');
};
