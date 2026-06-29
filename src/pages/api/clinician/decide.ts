import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase/admin';
import { getClinicalCore } from '../../../lib/adapters/factory';
import { ensureAccount } from '../../../lib/accounts';
import { decideClinicianAction, type ClinicianAction } from '../../../lib/clinician/decide';

// The clinician decision endpoint. Role-gated, then delegates to
// decideClinicianAction where the hard line is enforced (clinician actor,
// pending fast-lane item at in_review_queue, recorded reason, approve issues the
// script). Thin: all orchestration + guards live in the lib.
export const POST: APIRoute = async (ctx) => {
  const { user, env } = ctx.locals;
  if (!user) return ctx.redirect('/login');

  const admin = createAdminClient(env);
  const account = await ensureAccount(admin, user.id);
  if (account.role !== 'clinician') return ctx.redirect('/');

  const form = await ctx.request.formData();
  const queueItemId = String(form.get('queueItemId') ?? '');
  const action = String(form.get('action') ?? '') as ClinicianAction;
  const reason = String(form.get('reason') ?? '');

  if (!['approve', 'escalate', 'refuse'].includes(action)) {
    return ctx.redirect('/clinician?error=' + encodeURIComponent('Unknown decision action'));
  }

  const detail = '/clinician/intake/' + encodeURIComponent(queueItemId);
  try {
    const core = getClinicalCore(env, admin);
    const rxItems =
      action === 'approve'
        ? [
            {
              name: String(form.get('rxName') ?? '').trim() || 'Transdermal HRT (as assessed)',
              dose: String(form.get('rxDose') ?? '').trim() || undefined,
              quantity: Number(form.get('rxQuantity') ?? 1) || 1,
            },
          ]
        : undefined;

    await decideClinicianAction(admin, core, {
      clinicianAccountId: account.id,
      queueItemId,
      action,
      reason,
      rxItems,
    });
  } catch (err) {
    return ctx.redirect(
      detail +
        '?error=' +
        encodeURIComponent(err instanceof Error ? err.message : 'Could not record the decision'),
    );
  }

  // Back to the queue: the decided item drops out of the pending list.
  return ctx.redirect('/clinician');
};
