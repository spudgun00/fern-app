// Stripe webhook signature verification using Web Crypto (available on the
// Workers runtime and Node 20+), so we avoid pulling in the Node `stripe` SDK.
//
// Stripe signs each webhook with a `Stripe-Signature` header of the form
//   t=<timestamp>,v1=<hex hmac>,v1=<another>...
// where the signed payload is `${t}.${rawBody}` and the MAC is
// HMAC-SHA256(webhookSecret, signedPayload). We recompute it and compare in
// constant time. The raw request body (not a re-serialised object) must be used.

function hexFromBuffer(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export interface StripeWebhookEvent {
  type: string;
  data: { object: Record<string, unknown> };
}

// Verifies the signature and returns the parsed event, or throws. toleranceSecs
// guards against replay; pass `now` explicitly (epoch seconds) so this stays
// testable and free of ambient clock reads.
export async function verifyStripeWebhook(
  rawBody: string,
  signatureHeader: string | null,
  webhookSecret: string,
  now: number,
  toleranceSecs = 300,
): Promise<StripeWebhookEvent> {
  if (!signatureHeader) throw new Error('verifyStripeWebhook: missing Stripe-Signature header');

  const parts = Object.fromEntries(
    signatureHeader.split(',').map((kv) => {
      const idx = kv.indexOf('=');
      return [kv.slice(0, idx), kv.slice(idx + 1)];
    }),
  );
  const timestamp = parts['t'];
  const provided = parts['v1'];
  if (!timestamp || !provided) {
    throw new Error('verifyStripeWebhook: malformed signature header');
  }

  if (Math.abs(now - Number(timestamp)) > toleranceSecs) {
    throw new Error('verifyStripeWebhook: timestamp outside tolerance');
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  const expected = hexFromBuffer(mac);

  if (!timingSafeEqual(expected, provided)) {
    throw new Error('verifyStripeWebhook: signature mismatch');
  }

  return JSON.parse(rawBody) as StripeWebhookEvent;
}
