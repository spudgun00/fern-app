import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase/admin';
import { getClinicalCore } from '../../../lib/adapters/factory';
import { ensureAccount, getJourney } from '../../../lib/accounts';
import { CONDITION, parseIntakeAnswers } from '../../../lib/intake/questionnaire';
import { submitIntake } from '../../../lib/intake/submit';

// Intake submit. Parses the questionnaire, runs the deterministic routing, saves
// the answers to the core and advances the journey via submitIntake. Thin: all
// of the orchestration and the hard lines live in submitIntake / routeIntake.
export const POST: APIRoute = async (ctx) => {
  const { user, env } = ctx.locals;
  if (!user) return ctx.redirect('/login');

  const admin = createAdminClient(env);
  const account = await ensureAccount(admin, user.id);

  // Gates: a mapped core patient, and the ID gate (id_verified) must be passed.
  if (!account.core_patient_id) return ctx.redirect('/account/profile');
  const journey = await getJourney(admin, account.id);
  if (journey?.state !== 'id_verified') {
    // Not ready, or already submitted: send to /intake, which shows the right state.
    return ctx.redirect('/intake');
  }

  try {
    const form = await ctx.request.formData();
    const answers = parseIntakeAnswers(form);
    const core = getClinicalCore(env, admin);
    await submitIntake(admin, core, account.id, account.core_patient_id, CONDITION, answers);
  } catch (err) {
    return ctx.redirect(
      '/intake?error=' +
        encodeURIComponent(err instanceof Error ? err.message : 'Could not submit your intake'),
    );
  }

  return ctx.redirect('/intake');
};
