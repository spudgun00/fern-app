import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase/admin';
import { getClinicalCore } from '../../../lib/adapters/factory';
import { ensureAccount } from '../../../lib/accounts';
import { flagsFromEnv } from '../../../lib/cta';
import { submitMenopauseTreatment } from '../../../lib/menopause/treatment';
import type { MenopauseTreatmentAnswers } from '../../../lib/menopause/treatment-intake';

// Checkout C6 — record a patient's menopause treatment PREFERENCE. Runs the
// contraindication screen and writes the answers + validated selection to the
// core. It NEVER advances the journey (submitMenopauseTreatment does not touch
// the state machine), so choosing a treatment can never reach rx_issued — a
// clinician still issues every script.
//
// Gated three ways: patient-only, and a hard no-op unless menopauseRx is on (with
// it off nothing here resolves and the surface renders the placeholder instead).
export const POST: APIRoute = async (ctx) => {
  const { user, env } = ctx.locals;
  if (!user) return ctx.redirect('/login');

  const flags = flagsFromEnv(env);
  // Flag off: the treatment layer does not exist. No selection is recorded.
  if (!flags.menopauseRx) return ctx.redirect('/treatment/choose');

  const admin = createAdminClient(env);
  const account = await ensureAccount(admin, user.id);
  if (account.role !== 'patient' || !account.core_patient_id) return ctx.redirect('/');

  const form = await ctx.request.formData();
  const bool = (name: string) => form.get(name) === 'on' || form.get(name) === 'true';
  const answers: MenopauseTreatmentAnswers = {
    currentOrPastBreastCancer: bool('currentOrPastBreastCancer'),
    oestrogenDependentCancer: bool('oestrogenDependentCancer'),
    activeVte: bool('activeVte'),
    activeArterialDisease: bool('activeArterialDisease'),
    activeLiverDisease: bool('activeLiverDisease'),
    undiagnosedVaginalBleeding: bool('undiagnosedVaginalBleeding'),
    pregnancy: bool('pregnancy'),
    hasUterus: form.get('hasUterus') == null ? true : bool('hasUterus'),
    selectedProductId: String(form.get('selectedProductId') ?? '') || undefined,
  };

  try {
    const core = getClinicalCore(env, admin);
    const result = await submitMenopauseTreatment(
      admin,
      core,
      flags,
      account.id,
      account.core_patient_id,
      answers,
    );
    if (result.decision.outcome === 'stop') {
      return ctx.redirect(
        '/treatment/choose?notice=' +
          encodeURIComponent(
            'Based on your answers we cannot start this treatment online. Please speak to your GP or a specialist.',
          ),
      );
    }
    return ctx.redirect(
      '/treatment/choose?notice=' +
        encodeURIComponent(
          'Your preference has been recorded for your clinician. Nothing has been prescribed; a clinician makes the final decision.',
        ),
    );
  } catch (err) {
    return ctx.redirect(
      '/treatment/choose?error=' +
        encodeURIComponent(err instanceof Error ? err.message : 'Could not record your selection'),
    );
  }
};
