// Cal.com webhook signature verification using Web Crypto (available on the
// Workers runtime and Node 20+), so we avoid pulling in any SDK — the same stance
// as the Stripe webhook verifier.
//
// Cal.com signs each webhook with an `X-Cal-Signature-256` header: the hex
// HMAC-SHA256 of the RAW request body, keyed by the webhook's signing secret.
// (Unlike Stripe there is no timestamp in the signature, so no replay window to
// check here.) The raw request body, not a re-serialised object, must be used.

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

export interface CalcomWebhookEvent {
  triggerEvent: string;
  payload: Record<string, unknown>;
}

// Verifies the signature and returns the parsed event, or throws.
export async function verifyCalcomWebhook(
  rawBody: string,
  signatureHeader: string | null,
  webhookSecret: string,
): Promise<CalcomWebhookEvent> {
  if (!signatureHeader) throw new Error('verifyCalcomWebhook: missing X-Cal-Signature-256 header');

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = hexFromBuffer(mac);

  if (!timingSafeEqual(expected, signatureHeader.trim())) {
    throw new Error('verifyCalcomWebhook: signature mismatch');
  }

  return JSON.parse(rawBody) as CalcomWebhookEvent;
}
