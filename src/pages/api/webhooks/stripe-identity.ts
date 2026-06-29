import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase/admin';
import { verifyStripeWebhook } from '../../../lib/stripe-webhook';
import { getIdVerificationByRef } from '../../../lib/accounts';
import { finaliseVerification } from '../../../lib/verification';
import type { VerificationStatus } from '../../../lib/adapters/identity';

// Stripe Identity webhook (authoritative for the Stripe path). Verifies the
// signature with the webhook secret (no SDK), maps the verification session to
// an account via the stored provider_ref, and finalises. Idempotent with the
// return-page poll. Stripe sends application/json so Astro's checkOrigin (which
// only guards form POSTs) does not apply; the signature is the auth.
export const POST: APIRoute = async (ctx) => {
  const { env } = ctx.locals;
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response('Webhook not configured', { status: 503 });

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

  // Only the identity verification-session events concern us.
  if (event.type.startsWith('identity.verification_session.')) {
    const obj = event.data.object;
    const sessionId = String(obj.id ?? '');
    const status = String(obj.status ?? '') as VerificationStatus;

    const admin = createAdminClient(env);
    const record = await getIdVerificationByRef(admin, sessionId);
    if (record) {
      await finaliseVerification(admin, record.account_id, sessionId, status);
    }
  }

  return new Response('ok', { status: 200 });
};
