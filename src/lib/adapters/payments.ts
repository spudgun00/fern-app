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

// The priced things: the one-off consult fee (menopause full lane) and the
// recurring membership (both mode=payment / mode=subscription), the pay-first
// weight treatment charge (mode=payment, weight roadmap P4), and the C5 charges —
// the medication pass-through (Journey F, mode=payment) and the two add-ons
// (Journey G): the side-effect support kit ('addon_kit', one-off) and the
// recurring re-screen ('rescreen'). All one-offs except 'membership'.
export type CheckoutKind =
  | 'consult'
  | 'membership'
  | 'treatment'
  | 'medication'
  | 'addon_kit'
  | 'rescreen'
  // Shop S3: the single basket-level payment for a mixed cart (one charge for the
  // whole basket; the fulfilment router then splits OTC vs prescription lines).
  | 'basket';

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
  // C4: ensure a single provider customer exists for this patient, reused across
  // one-offs + subscription + portal. Returns the existing ref when passed one,
  // else creates a customer and returns its id. The caller persists the id
  // (payments_customer) and passes it back on later checkouts.
  ensureCustomer(accountId: string, existingRef?: string | null): Promise<string>;
  createCheckout(
    kind: CheckoutKind,
    accountId: string,
    returnUrl: string,
    // C4: attach the session to the patient's single customer so one-offs +
    // subscription + portal all resolve to the same customer.
    customerRef?: string | null,
  ): Promise<CheckoutSession>;
  getCheckoutStatus(sessionId: string): Promise<CheckoutResult>;
  createPortalSession(customerRef: string, returnUrl: string): Promise<PortalSession>;
  // Refund a completed one-off payment by its checkout-session pointer. Used for
  // the AUTOMATIC refund-on-refusal on the pay-first weight lane (P4): when a
  // clinician refuses a POM the patient paid for up front, the charge is returned
  // instantly, in code, not manually. Idempotent-ish: refunding an already
  // refunded / unpaid session is the provider's concern; callers gate on a paid
  // treatment payment_ref before calling.
  //
  // Shop S4: an OPTIONAL amountMinor (in the smallest currency unit, e.g. pence)
  // makes it a PARTIAL refund. This is the per-line refund for a MIXED basket: when
  // a clinician refuses the prescription line of a basket that also has OTC lines
  // (all on ONE payment), only the prescription line's amount is returned, so the
  // shipped OTC lines are NOT refunded. Omitted -> a full refund (the weight P4
  // lane, unchanged).
  refund(sessionId: string, amountMinor?: number): Promise<void>;
}
