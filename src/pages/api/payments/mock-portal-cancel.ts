import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase/admin';
import { getPayments } from '../../../lib/adapters/factory';
import { MockPayments } from '../../../lib/adapters/mock-payments';
import { ensureAccount, getMembership } from '../../../lib/accounts';
import { finaliseMembershipCancel } from '../../../lib/payments/billing';

// Mock-only: stands in for cancelling a subscription in the provider portal. The
// real Stripe path emits a customer.subscription.deleted webhook that flips the
// membership state; here the mock portal page posts this to the same effect, so
// the cancel -> membership-state-update path is walkable on the deployed URL.
export const POST: APIRoute = async (ctx) => {
  const { user, env } = ctx.locals;
  if (!user) return ctx.redirect('/login');

  const admin = createAdminClient(env);
  const account = await ensureAccount(admin, user.id);

  const payments = getPayments(env, admin);
  if (!(payments instanceof MockPayments)) {
    return ctx.redirect('/account/billing?error=' + encodeURIComponent('Mock portal disabled'));
  }

  const membership = await getMembership(admin, account.id);
  if (membership?.provider_customer_ref) {
    await payments.cancelByCustomer(membership.provider_customer_ref);
    await finaliseMembershipCancel(admin, membership.provider_customer_ref);
  }

  return ctx.redirect(
    '/account/billing?notice=' + encodeURIComponent('Membership cancelled.'),
  );
};
