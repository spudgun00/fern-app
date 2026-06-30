import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase/admin';
import { applyPersona, resetAndSweep } from '../../../lib/demo/personas';
import { ensureAccount } from '../../../lib/accounts';

// D4 reviewer panel: apply a curated demo persona to the logged-in account, then
// land the reviewer at the actionable point of that path on the styled surfaces.
// Resets + sweeps first (a clean slate, no stale mock_* from the prior walk).
// The special id "reset" sweeps the account back to a clean slate with no seed.
//
// HARD LINE: the persona seeds dummy data up to a clinician decision; it never
// auto-issues a script (see src/lib/demo/personas.ts). This route only seeds and
// redirects.
export const POST: APIRoute = async (ctx) => {
  const { user, env } = ctx.locals;
  if (!user) return ctx.redirect('/login');

  const form = await ctx.request.formData();
  const personaId = String(form.get('persona') ?? '');

  const admin = createAdminClient(env);
  try {
    if (personaId === 'reset') {
      const account = await ensureAccount(admin, user.id);
      await resetAndSweep(admin, account);
      return ctx.redirect('/demo?notice=' + encodeURIComponent('Reset to a clean slate.'));
    }
    const { landing } = await applyPersona(env, admin, user.id, personaId, user.email);
    return ctx.redirect(landing);
  } catch (err) {
    return ctx.redirect(
      '/demo?error=' +
        encodeURIComponent(err instanceof Error ? err.message : 'Could not start that walk'),
    );
  }
};
