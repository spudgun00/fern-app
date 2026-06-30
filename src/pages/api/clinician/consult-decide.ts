import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase/admin';
import { getClinicalCore, getDispensing, getEmail } from '../../../lib/adapters/factory';
import { ensureAccount } from '../../../lib/accounts';
import { decideConsultAction, type ConsultAction } from '../../../lib/clinician/consult';
import { dispenseIssuedScript } from '../../../lib/dispensing/dispense';

// The full-lane clinician decision endpoint. Role-gated, then delegates to
// decideConsultAction where the hard line is enforced (clinician actor, booked
// consult at consult_booked/consult_done, recorded reason, issue issues the
// script). Thin: all orchestration + guards live in the lib. Composes
// dispenseIssuedScript after an issue, exactly as /api/clinician/decide does on
// approve — decision and transmission stay separate functions.
export const POST: APIRoute = async (ctx) => {
  const { user, env } = ctx.locals;
  if (!user) return ctx.redirect('/login');

  const admin = createAdminClient(env);
  const account = await ensureAccount(admin, user.id);
  if (account.role !== 'clinician') return ctx.redirect('/');

  const form = await ctx.request.formData();
  const bookingRefId = String(form.get('bookingRefId') ?? '');
  const action = String(form.get('action') ?? '') as ConsultAction;
  const reason = String(form.get('reason') ?? '');

  if (!['issue', 'refuse'].includes(action)) {
    return ctx.redirect(
      '/clinician/consults?error=' + encodeURIComponent('Unknown decision action'),
    );
  }

  const detail = '/clinician/consult/' + encodeURIComponent(bookingRefId);
  try {
    const core = getClinicalCore(env, admin);
    const rxItems =
      action === 'issue'
        ? [
            {
              name: String(form.get('rxName') ?? '').trim() || 'Transdermal HRT (as assessed)',
              dose: String(form.get('rxDose') ?? '').trim() || undefined,
              quantity: Number(form.get('rxQuantity') ?? 1) || 1,
            },
          ]
        : undefined;

    const result = await decideConsultAction(admin, core, {
      clinicianAccountId: account.id,
      bookingRefId,
      action,
      reason,
      rxItems,
    });

    // On issue the script is issued (decide stops at rx_issued, the clinical
    // decision). The issued script then flows to dispensing (rx_issued ->
    // dispensing) through the CloudRx adapter — the same dispense function the
    // fast lane uses. Decision and transmission stay separate; the route composes.
    if (result.action === 'issue' && result.rxId) {
      const dispensing = getDispensing(env, admin);
      await dispenseIssuedScript(
        admin,
        core,
        dispensing,
        {
          accountId: result.patientAccountId,
          corePatientId: result.corePatientId,
          rxId: result.rxId,
        },
        { email: getEmail(env, admin), baseUrl: new URL(ctx.request.url).origin },
      );
    }
  } catch (err) {
    return ctx.redirect(
      detail +
        '?error=' +
        encodeURIComponent(err instanceof Error ? err.message : 'Could not record the decision'),
    );
  }

  return ctx.redirect('/clinician/consults');
};
