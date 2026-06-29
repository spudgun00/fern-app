import type { SupabaseClient } from '@supabase/supabase-js';
import type { CheckoutKind, PaymentsAdapter } from '../adapters/payments';
import {
  advanceJourney,
  getJourney,
  getMembership,
  getLatestPaymentRef,
  getLatestPendingPaymentRef,
  hasPaidConsult,
  isActiveMember,
  recordPaymentRef,
  setMembershipStatusByCustomer,
  setPaymentRefStatus,
  upsertMembership,
  type Membership,
} from '../accounts';

// ===========================================================================
// P5 — payment + membership + repeat tiering. The money model.
//
// Two priced things go through the PaymentsAdapter (Stripe Checkout + Billing,
// mocked behind MockPayments now): the one-off consult fee (~£100) and the
// recurring membership (~£18/mo). The tiering rule, baked in below:
//
//   * FIRST script  = consult-priced. The full-lane booking (P6) is gated on
//     hasPaidConsult; P5 builds + proves that gate.
//   * REPEATS        = membership-covered. A member's repeat enters the review
//     queue with NO new consult charge (enforced in lodgeRepeatRequest).
//
// BOUNDARY (hard line): card data + the customer record live with the provider
// (Stripe), never in the app DB. The app DB holds payment_ref + membership,
// POINTERS + coarse status only. Decision/transmission stay separate from money:
// paying does NOT issue a script (a clinician still decides); money only gates.
// ===========================================================================

// Start a checkout for the consult fee or the membership. We record a pending
// payment_ref pointer up front for BOTH kinds (provider_ref = the session id),
// so the return page can find and finalise the in-flight session, exactly as the
// ID-verify start records a provider pointer. The membership SUBSCRIPTION row is
// written on completion, once the provider mints the customer + subscription ids.
export async function startCheckout(
  admin: SupabaseClient,
  payments: PaymentsAdapter,
  kind: CheckoutKind,
  accountId: string,
  returnUrl: string,
): Promise<string> {
  const session = await payments.createCheckout(kind, accountId, returnUrl);
  await recordPaymentRef(admin, accountId, kind, session.sessionId, 'pending');
  return session.clientUrl;
}

// The return-page entry point: finalise whatever checkout is in flight for this
// account (the latest pending payment_ref). Idempotent with the webhook and safe
// to call on every load of the return page. Returns null if nothing is pending.
export async function finaliseLatestPending(
  admin: SupabaseClient,
  payments: PaymentsAdapter,
  accountId: string,
): Promise<{ kind: CheckoutKind; complete: boolean } | null> {
  const pending = await getLatestPendingPaymentRef(admin, accountId);
  if (!pending?.provider_ref) return null;
  return finaliseCheckout(admin, payments, accountId, pending.provider_ref);
}

// Finalise a checkout from the return page poll (idempotent with the webhook).
// Reads the live provider status and, when complete:
//   * consult    -> mark the payment_ref paid (the consult gate flips).
//   * membership -> upsert the membership active with the provider pointers, then
//     advance delivered -> active_member when the patient sits at delivered (the
//     spec-exact transition; idempotent, so the webhook + poll can both fire).
// Returns the resulting membership/consult status for display.
export async function finaliseCheckout(
  admin: SupabaseClient,
  payments: PaymentsAdapter,
  accountId: string,
  sessionId: string,
): Promise<{ kind: CheckoutKind; complete: boolean }> {
  const result = await payments.getCheckoutStatus(sessionId);
  const complete = result.status === 'complete';

  if (complete) {
    // Both kinds: mark the session pointer paid so the gate / pending state flips
    // and the return page stops re-finalising.
    await setPaymentRefStatus(admin, sessionId, 'paid');
  }

  if (complete && result.kind === 'membership') {
    await upsertMembership(admin, accountId, {
      status: 'active',
      providerCustomerRef: result.customerRef ?? null,
      providerSubscriptionRef: result.subscriptionRef ?? null,
    });
    await advanceToActiveMemberIfEligible(admin, accountId);
  }

  return { kind: result.kind, complete };
}

// delivered -> active_member, only when the patient is at delivered (the single
// legal predecessor). Guarded + idempotent: a member who has not yet reached
// delivered keeps an active membership row, and advances when eligible. Mirrors
// finaliseVerification's id_pending -> id_verified guard.
export async function advanceToActiveMemberIfEligible(
  admin: SupabaseClient,
  accountId: string,
): Promise<void> {
  if (!(await isActiveMember(admin, accountId))) return;
  const journey = await getJourney(admin, accountId);
  if (journey?.state === 'delivered') {
    await advanceJourney(admin, accountId, 'active_member');
  }
}

// Webhook path: a subscription cancelled in the provider portal maps a customer
// id back to its membership row and marks it canceled. The journey state is not
// rolled back (active_member is terminal in the machine); the membership row is
// the authoritative billing-access status, so a canceled member loses the
// no-charge repeat tiering.
export async function finaliseMembershipCancel(
  admin: SupabaseClient,
  providerCustomerRef: string,
): Promise<void> {
  await setMembershipStatusByCustomer(admin, providerCustomerRef, 'canceled');
}

export interface BillingView {
  consultPaid: boolean;
  membership: Membership | null;
  isMember: boolean;
  // The pending consult checkout pointer (if a checkout was started but not yet
  // completed), surfaced so the page can show "awaiting payment".
  consultPending: boolean;
}

export async function getBillingView(
  admin: SupabaseClient,
  accountId: string,
): Promise<BillingView> {
  const consultRef = await getLatestPaymentRef(admin, accountId, 'consult');
  const membership = await getMembership(admin, accountId);
  return {
    consultPaid: consultRef?.status === 'paid',
    membership,
    isMember: membership?.status === 'active',
    consultPending: consultRef?.status === 'pending',
  };
}

// Re-export the gate so callers (P6 booking, the repeat path) import the tiering
// from one place.
export { hasPaidConsult, isActiveMember };
