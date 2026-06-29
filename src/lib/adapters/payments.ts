// The payments boundary. ALL payment + subscription operations go through this
// one interface, so the rest of the app stays provider-agnostic (Stripe now,
// another processor later) exactly as the clinical core, dispensing, and
// identity boundaries do. Never branch on the impl outside the factory.
//
// HARD LINE (P5): card data and the customer/payment-method record live with the
// provider (Stripe), NEVER in the app DB. This interface deliberately surfaces
// only a session pointer (sessionId), a redirect URL, and a coarse status, plus
// the provider customer/subscription ids needed to drive the portal and the
// membership state. No method returns card details, a billing address, or PII.
// The app DB stores provider pointers + status only.

// The two priced things: the one-off consult fee (mode=payment) and the
// recurring membership (mode=subscription).
export type CheckoutKind = 'consult' | 'membership';

export interface CheckoutSession {
  // Opaque provider session id. Persisted app-side as a pointer only.
  sessionId: string;
  // Where to send the user to pay (provider-hosted for Stripe, an in-app mock
  // page for MockPayments).
  clientUrl: string;
}

export type CheckoutStatus =
  | 'open' // created, awaiting payment
  | 'complete' // paid (one-off) or subscription started
  | 'expired'; // abandoned

export interface CheckoutResult {
  status: CheckoutStatus;
  kind: CheckoutKind;
  // For a completed membership checkout: the provider customer + subscription
  // ids (pointers, used to drive the portal and the membership state). Absent
  // for a consult (one-off) checkout.
  customerRef?: string;
  subscriptionRef?: string;
}

export interface PortalSession {
  // Where to send the user to manage / cancel their subscription (Stripe's
  // hosted customer portal, or an in-app mock portal for MockPayments).
  portalUrl: string;
}

export interface PaymentsAdapter {
  createCheckout(
    kind: CheckoutKind,
    accountId: string,
    returnUrl: string,
  ): Promise<CheckoutSession>;
  getCheckoutStatus(sessionId: string): Promise<CheckoutResult>;
  createPortalSession(customerRef: string, returnUrl: string): Promise<PortalSession>;
}
