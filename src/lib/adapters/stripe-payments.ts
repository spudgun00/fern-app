import type {
  CheckoutKind,
  CheckoutResult,
  CheckoutSession,
  PaymentsAdapter,
  PortalSession,
} from './payments';

// StripePayments: the real provider integration, behind the same PaymentsAdapter
// interface as MockPayments. Calls the Stripe REST API directly via fetch — we
// deliberately do NOT pull in the Node `stripe` SDK, which is heavy on the
// Workers runtime, exactly as StripeIdentity does. Test mode only until go-live
// (sk_test_ keys, test-mode price ids).
//
// HARD LINE: this adapter returns only the session id / hosted-flow URL, a coarse
// status, and the provider customer/subscription pointers. Card data and the
// customer record stay with Stripe; the app persists pointers + status only.
const STRIPE_API = 'https://api.stripe.com/v1';

export class StripePayments implements PaymentsAdapter {
  constructor(
    private readonly secretKey: string,
    private readonly priceConsult: string,
    private readonly priceMembership: string,
  ) {
    if (!secretKey) {
      throw new Error('StripePayments: STRIPE_SECRET_KEY is required when PAYMENTS_IMPL=stripe');
    }
    if (!priceConsult || !priceMembership) {
      throw new Error(
        'StripePayments: STRIPE_PRICE_CONSULT and STRIPE_PRICE_MEMBERSHIP are required when PAYMENTS_IMPL=stripe',
      );
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
      throw new Error(`StripePayments ${method} ${path}: ${message}`);
    }
    return json;
  }

  async createCheckout(
    kind: CheckoutKind,
    accountId: string,
    returnUrl: string,
  ): Promise<CheckoutSession> {
    // The consult is a one-off (mode=payment); the membership is recurring
    // (mode=subscription). metadata.account_id + metadata.kind let the webhook
    // map the session back to an account with no PII. Stripe holds the card.
    const isMembership = kind === 'membership';
    const json = await this.call('/checkout/sessions', 'POST', {
      mode: isMembership ? 'subscription' : 'payment',
      'line_items[0][price]': isMembership ? this.priceMembership : this.priceConsult,
      'line_items[0][quantity]': '1',
      success_url: returnUrl,
      cancel_url: returnUrl,
      client_reference_id: accountId,
      'metadata[account_id]': accountId,
      'metadata[kind]': kind,
    });
    return { sessionId: String(json.id), clientUrl: String(json.url) };
  }

  async getCheckoutStatus(sessionId: string): Promise<CheckoutResult> {
    const json = await this.call(`/checkout/sessions/${sessionId}`, 'GET');
    // status: open | complete | expired. For a membership the customer +
    // subscription ids are pointers we keep to drive the portal + state.
    const kind = ((json.metadata as Record<string, string> | undefined)?.kind ??
      'consult') as CheckoutKind;
    return {
      status: String(json.status) as CheckoutResult['status'],
      kind,
      customerRef: json.customer != null ? String(json.customer) : undefined,
      subscriptionRef: json.subscription != null ? String(json.subscription) : undefined,
    };
  }

  async createPortalSession(customerRef: string, returnUrl: string): Promise<PortalSession> {
    const json = await this.call('/billing_portal/sessions', 'POST', {
      customer: customerRef,
      return_url: returnUrl,
    });
    return { portalUrl: String(json.url) };
  }

  // Refund a completed one-off Checkout by its session id: resolve the session's
  // payment_intent, then create a full refund against it. Used by the automatic
  // refund-on-refusal on the pay-first weight lane. (Test mode until go-live; the
  // exercised path in this build is MockPayments.refund.)
  async refund(sessionId: string): Promise<void> {
    const session = await this.call(`/checkout/sessions/${sessionId}`, 'GET');
    const paymentIntent = session.payment_intent;
    if (paymentIntent == null) {
      throw new Error(`StripePayments.refund: session ${sessionId} has no payment_intent`);
    }
    await this.call('/refunds', 'POST', { payment_intent: String(paymentIntent) });
  }
}
