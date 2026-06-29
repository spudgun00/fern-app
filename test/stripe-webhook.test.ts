import { describe, expect, it } from 'vitest';
import { verifyStripeWebhook } from '../src/lib/stripe-webhook';

// Pure (no network): proves the Stripe path's webhook auth. Signs a payload the
// way Stripe does and checks accept/reject. The webhook is how the real Stripe
// verification authoritatively reaches id_verified, so its signature check is
// load-bearing for success test C.
const SECRET = 'whsec_test_secret';

async function sign(payload: string, timestamp: number, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  );
  const hex = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `t=${timestamp},v1=${hex}`;
}

describe('verifyStripeWebhook', () => {
  const now = 1_700_000_000;
  const payload = JSON.stringify({
    type: 'identity.verification_session.verified',
    data: { object: { id: 'vs_123', status: 'verified' } },
  });

  it('accepts a correctly signed, in-tolerance payload and parses the event', async () => {
    const header = await sign(payload, now);
    const event = await verifyStripeWebhook(payload, header, SECRET, now);
    expect(event.type).toBe('identity.verification_session.verified');
    expect(event.data.object.id).toBe('vs_123');
    expect(event.data.object.status).toBe('verified');
  });

  it('rejects a tampered payload', async () => {
    const header = await sign(payload, now);
    const tampered = payload.replace('vs_123', 'vs_evil');
    await expect(verifyStripeWebhook(tampered, header, SECRET, now)).rejects.toThrow(/mismatch/i);
  });

  it('rejects a wrong secret', async () => {
    const header = await sign(payload, now, 'whsec_wrong');
    await expect(verifyStripeWebhook(payload, header, SECRET, now)).rejects.toThrow(/mismatch/i);
  });

  it('rejects a missing signature header', async () => {
    await expect(verifyStripeWebhook(payload, null, SECRET, now)).rejects.toThrow(/missing/i);
  });

  it('rejects a replay outside the timestamp tolerance', async () => {
    const header = await sign(payload, now - 10_000);
    await expect(verifyStripeWebhook(payload, header, SECRET, now)).rejects.toThrow(/tolerance/i);
  });
});
