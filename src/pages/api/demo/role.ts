import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase/admin';
import { ensureAccount } from '../../../lib/accounts';
import { setRole } from '../../../lib/demo/personas';

// D4 reviewer panel: flip the logged-in account between patient and clinician so
// a reviewer can walk both sides of a path (e.g. pay + book as the patient, then
// issue as the clinician) on one account. Redirects back to a return URL so the
// switch stays inside the demo flow. Same affordance the dev harness uses.
export const POST: APIRoute = async (ctx) => {
  const { user, env } = ctx.locals;
  if (!user) return ctx.redirect('/login');

  const form = await ctx.request.formData();
  const role = String(form.get('role') ?? '');
  const ret = String(form.get('return') ?? '/demo');
  // Only allow same-origin app paths as the return target.
  const safeReturn = ret.startsWith('/') ? ret : '/demo';

  if (role !== 'patient' && role !== 'clinician') {
    return ctx.redirect('/demo?error=' + encodeURIComponent('Unknown role'));
  }

  const admin = createAdminClient(env);
  const account = await ensureAccount(admin, user.id);
  await setRole(admin, account.id, role);

  return ctx.redirect(safeReturn);
};
