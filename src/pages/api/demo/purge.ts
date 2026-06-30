import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase/admin';
import { ensureAccount } from '../../../lib/accounts';
import { purgeAllDemoData, resetAndSweep } from '../../../lib/demo/personas';

// D4 reviewer panel: the global "purge all demo data" control, for a fresh
// handover. Wipes EVERY mock_* row across all accounts (the throwaway namespaced
// tables ONLY — never auth users), then resets the current account so the panel
// reads a clean slate. Destructive and demo-only, so it is fenced: the form must
// post an explicit confirm. The hard boundary the whole build holds is preserved
// — this never touches Supabase auth users (cleaned separately, supervised).
export const POST: APIRoute = async (ctx) => {
  const { user, env } = ctx.locals;
  if (!user) return ctx.redirect('/login');

  const form = await ctx.request.formData();
  if (String(form.get('confirm') ?? '') !== 'purge') {
    return ctx.redirect(
      '/demo?error=' + encodeURIComponent('Tick the confirm box to purge all demo data'),
    );
  }

  const admin = createAdminClient(env);
  try {
    await purgeAllDemoData(admin);
    // Leave the current account on a clean slate (its journey otherwise points at
    // a now-deleted mock patient).
    const account = await ensureAccount(admin, user.id);
    await resetAndSweep(admin, account);
    return ctx.redirect(
      '/demo?notice=' + encodeURIComponent('All demo data purged. Clean slate for a fresh walk.'),
    );
  } catch (err) {
    return ctx.redirect(
      '/demo?error=' +
        encodeURIComponent(err instanceof Error ? err.message : 'Could not purge demo data'),
    );
  }
};
