import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase/admin';
import { getClinicalCore } from '../../../lib/adapters/factory';
import { ensureCorePatient } from '../../../lib/onboarding';
import {
  ensureAccount,
  recordGpSharing,
  type GpSharingDecision,
} from '../../../lib/accounts';

// Profile POST: creates the clinical-core patient (idempotently) with the
// demographic identity, maps corePatientId onto the account, and records the GP
// info-sharing decision. Demographics go to the CORE via createPatient, never
// into the app DB. No journey transition here; ID start (registered ->
// id_pending) happens on /account/verify.
export const POST: APIRoute = async (ctx) => {
  const { user, env } = ctx.locals;
  if (!user) return ctx.redirect('/login');

  const form = await ctx.request.formData();
  const fullName = String(form.get('fullName') ?? '').trim();
  const dateOfBirth = String(form.get('dateOfBirth') ?? '').trim();
  const contact = String(form.get('contact') ?? '').trim();
  const gpPractice = String(form.get('gpPractice') ?? '').trim();
  const gpDecision = String(form.get('gpDecision') ?? '') as GpSharingDecision;
  const riskNote = String(form.get('riskNote') ?? '');

  const fail = (msg: string) =>
    ctx.redirect('/account/profile?error=' + encodeURIComponent(msg));

  if (!fullName || !dateOfBirth || !contact) {
    return fail('Name, date of birth and contact are required');
  }
  if (gpDecision !== 'consent' && gpDecision !== 'refused') {
    return fail('Please record a GP information-sharing decision');
  }
  if (gpDecision === 'refused' && riskNote.trim() === '') {
    return fail('A risk note is required when you do not consent to GP sharing');
  }

  const admin = createAdminClient(env);
  const account = await ensureAccount(admin, user.id);

  try {
    // Create the core patient ONCE (idempotent on re-submit). Demographics go
    // to the core, never the app DB.
    await ensureCorePatient(admin, getClinicalCore(env, admin), account.id, {
      fullName,
      dateOfBirth,
      email: user.email,
      contact,
      gpPractice,
    });

    // recordGpSharing re-enforces the refusal-requires-note hard line server-side.
    await recordGpSharing(admin, account.id, gpDecision, gpDecision === 'refused' ? riskNote : null);
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not save your profile');
  }

  return ctx.redirect('/account/verify');
};
