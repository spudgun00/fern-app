import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase/admin';
import { verifyStripeWebhook } from '../../../lib/stripe-webhook';
import {
  setPaymentRefStatus,
  upsertMembership,
} from '../../../lib/accounts';
import {
  advanceToActiveMemberIfEligible,
  finaliseMembershipCancel,
} from '../../../lib/payments/billing';

// Stripe Checkout + Billing webhook (authoritative for the Stripe path). Verifies
// the signature with the billing webhook secret (no SDK, same HMAC check as the
// identity webhook), maps each event to an account via metadata / the customer
// pointer, and updates payment + membership state. Idempotent with the return-page
// poll (finaliseLatestPending). Stripe sends application/json so Astro's
// checkOrigin (which only guards form POSTs) does not apply; the signature is the
// auth. Card data never reaches here: events carry pointers + status only.
export const POST: APIRoute = async (ctx) => {
  const { env } = ctx.locals;
  const secret = env.STRIPE_BILLING_WEBHOOK_SECRET;
  if (!secret) return new Response('Billing webhook not configured', { status: 503 });

  const rawBody = await ctx.request.text();
  const sig = ctx.request.headers.get('stripe-signature');

  let event;
  try {
    const now = Math.floor(Date.now() / 1000);
    event = await verifyStripeWebhook(rawBody, sig, secret, now);
  } catch (err) {
    return new Response(
      `Signature verification failed: ${err instanceof Error ? err.message : String(err)}`,
      { status: 400 },
    );
  }

  const admin = createAdminClient(env);
  const obj = event.data.object;

  if (event.type === 'checkout.session.completed') {
    const sessionId = String(obj.id ?? '');
    const metadata = (obj.metadata ?? {}) as Record<string, string>;
    const accountId = metadata.account_id ?? '';
    const kind = metadata.kind ?? 'consult';

    if (sessionId) await setPaymentRefStatus(admin, sessionId, 'paid');

    if (kind === 'membership' && accountId) {
      await upsertMembership(admin, accountId, {
        status: 'active',
        providerCustomerRef: obj.customer != null ? String(obj.customer) : null,
        providerSubscriptionRef: obj.subscription != null ? String(obj.subscription) : null,
      });
      await advanceToActiveMemberIfEligible(admin, accountId);
    }
  } else if (
    event.type === 'customer.subscription.deleted' ||
    (event.type === 'customer.subscription.updated' && String(obj.status ?? '') === 'canceled')
  ) {
    // A subscription cancelled in the portal flips the membership state. Mapped
    // by the customer pointer (the cancel event has no account metadata).
    const customer = obj.customer != null ? String(obj.customer) : '';
    if (customer) await finaliseMembershipCancel(admin, customer);
  }

  return new Response('ok', { status: 200 });
};
