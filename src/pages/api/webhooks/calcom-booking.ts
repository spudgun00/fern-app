import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase/admin';
import { verifyCalcomWebhook } from '../../../lib/calcom-webhook';
import { getBooking, getVideo, getEmail } from '../../../lib/adapters/factory';
import { getBookingRefByProviderRef } from '../../../lib/accounts';
import { finaliseBooking } from '../../../lib/consult/booking';

// Cal.com booking webhook (authoritative for the Cal.com path). Verifies the
// signature with the Cal.com webhook secret (no SDK, HMAC over the raw body),
// maps the booking to an account via the fernRef correlation pointer carried in
// the booking metadata, and finalises (create the video room + advance to
// consult_booked). Idempotent with the return-page poll (finaliseLatestBooking).
// Cal.com sends application/json so Astro's checkOrigin (which only guards form
// POSTs) does not apply; the signature is the auth.
export const POST: APIRoute = async (ctx) => {
  const { env } = ctx.locals;
  const secret = env.CALCOM_WEBHOOK_SECRET;
  if (!secret) return new Response('Booking webhook not configured', { status: 503 });

  const rawBody = await ctx.request.text();
  const sig = ctx.request.headers.get('x-cal-signature-256');

  let event;
  try {
    event = await verifyCalcomWebhook(rawBody, sig, secret);
  } catch (err) {
    return new Response(
      `Signature verification failed: ${err instanceof Error ? err.message : String(err)}`,
      { status: 400 },
    );
  }

  // Only booking-created / rescheduled events advance the journey.
  if (event.triggerEvent === 'BOOKING_CREATED' || event.triggerEvent === 'BOOKING_RESCHEDULED') {
    const metadata = (event.payload.metadata ?? {}) as Record<string, string>;
    const fernRef = metadata.fernRef ?? '';

    if (fernRef) {
      const admin = createAdminClient(env);
      const ref = await getBookingRefByProviderRef(admin, fernRef);
      if (ref) {
        const booking = getBooking(env, admin);
        const video = getVideo(env, admin);
        await finaliseBooking(admin, booking, video, ref.account_id, ref, {
          email: getEmail(env, admin),
          baseUrl: new URL(ctx.request.url).origin,
        });
      }
    }
  }

  return new Response('ok', { status: 200 });
};
