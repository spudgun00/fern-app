import type {
  IdentityAdapter,
  VerificationSession,
  VerificationStatus,
} from './identity';

// StripeIdentity: the real provider integration, behind the same IdentityAdapter
// interface as MockIdentity. Calls the Stripe REST API directly via fetch — we
// deliberately do NOT pull in the Node `stripe` SDK, which is heavy on the
// Workers runtime. Test mode only until go-live (sk_test_ keys).
//
// HARD LINE: this adapter returns only the session id, the hosted-flow URL, and
// a coarse status. Document images and extracted PII stay with Stripe; the app
// persists provider_ref + status only. Stripe's VerificationSession.status
// values map 1:1 onto VerificationStatus.
const STRIPE_API = 'https://api.stripe.com/v1';

export class StripeIdentity implements IdentityAdapter {
  constructor(private readonly secretKey: string) {
    if (!secretKey) {
      throw new Error('StripeIdentity: STRIPE_SECRET_KEY is required when IDENTITY_IMPL=stripe');
    }
  }

  private async call(path: string, method: 'GET' | 'POST', form?: Record<string, string>) {
    const res = await fetch(`${STRIPE_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const message =
        (json.error as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`;
      throw new Error(`StripeIdentity ${method} ${path}: ${message}`);
    }
    return json;
  }

  async createVerificationSession(
    accountId: string,
    returnUrl: string,
  ): Promise<VerificationSession> {
    // metadata.account_id lets the webhook map the session back to an account
    // without storing any PII. The document image is held by Stripe, not us.
    const json = await this.call('/identity/verification_sessions', 'POST', {
      type: 'document',
      return_url: returnUrl,
      'metadata[account_id]': accountId,
    });
    return { sessionId: String(json.id), clientUrl: String(json.url) };
  }

  async getVerificationStatus(sessionId: string): Promise<VerificationStatus> {
    const json = await this.call(
      `/identity/verification_sessions/${sessionId}`,
      'GET',
    );
    return String(json.status) as VerificationStatus;
  }
}
