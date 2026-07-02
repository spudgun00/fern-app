import type { SupabaseClient } from '@supabase/supabase-js';
import type { PaymentsAdapter } from '../adapters/payments';
import type { ScreeningAdapter } from '../adapters/screening';
import {
  getJourney,
  getLatestPaymentRef,
  hasPaidTreatment,
  recordCheckoutConsent,
  recordPaymentRef,
  setPaymentRefStatus,
} from '../accounts';
import { orderScreeningKit } from '../screening/order';
import { getOrCreateCustomer } from '../payments/billing';
import type { Product } from './products';

// ===========================================================================
// Checkout C2 — the shared one-off checkout orchestration (journeys A + B).
//
// Both journeys pay through the existing pay-first 'treatment' payment kind, so
// the built automatic refund-on-refusal (P4) covers both without change. This
// module adds ONLY the checkout-start (consent + pending pointer) and the GATE
// that turns a completed payment into the screening branch.
//
// THE GATE (the C2 requirement): a completed treatment payment advances
// `intake_submitted -> screening_kit_sent` (it orders the shared screening kit),
// and NOTHING more. It never reaches a decision state, never issues a script:
// a clinician still decides once the bloods are in (the screening guard), and
// rx_issued stays reachable ONLY from approved / consult_done. Money gates the
// non-clinical screening step; it is never a predecessor of a prescription.
// ===========================================================================

// Start a one-off checkout for a product descriptor (C2 treatment / C3 consult).
// Records the explicit, timestamped consent (waitlist discipline) and the pending
// payment_ref pointer under the product's payment kind, then returns the
// provider/mock hosted checkout URL. The card is taken by the provider; the app DB
// only ever sees the session pointer + status + a consent record (no amount, no
// card data, no PII).
export async function startProductCheckout(
  admin: SupabaseClient,
  payments: PaymentsAdapter,
  product: Product,
  accountId: string,
  returnUrl: string,
): Promise<string> {
  // C4: attach to the patient's single provider customer (one per patient across
  // one-offs + subscription + portal).
  const customerRef = await getOrCreateCustomer(admin, payments, accountId);
  const session = await payments.createCheckout(product.kind, accountId, returnUrl, customerRef);
  await recordPaymentRef(admin, accountId, product.kind, session.sessionId, 'pending');
  // Consent is captured at the checkout, tied to the session pointer + product.
  await recordCheckoutConsent(admin, accountId, product.id, session.sessionId);
  return session.clientUrl;
}

// Back-compat alias: the treatment checkout is a product checkout. Kept so C2
// callers/tests read as before.
export const startTreatmentCheckout = startProductCheckout;

export interface TreatmentGateResult {
  // The latest treatment payment status (pending | paid | refunded | ...).
  paymentStatus: string | null;
  // True when this call advanced intake_submitted -> screening_kit_sent.
  advancedToScreening: boolean;
  // The journey state after the gate ran.
  state: string | null;
}

// THE GATE. When the patient has PAID for treatment and is sitting at
// intake_submitted, order the shared screening kit (intake_submitted ->
// screening_kit_sent). Idempotent: if the payment is not paid, or the patient is
// not at intake_submitted (kit already ordered, or a red-flag stop), it is a
// no-op. Never advances past screening_kit_sent, never toward a decision state.
export async function advanceOnTreatmentPaid(
  admin: SupabaseClient,
  screening: ScreeningAdapter,
  accountId: string,
  corePatientId: string,
): Promise<TreatmentGateResult> {
  const ref = await getLatestPaymentRef(admin, accountId, 'treatment');
  const journey = await getJourney(admin, accountId);
  const paymentStatus = ref?.status ?? null;

  // Gate strictly on paymentStatus='paid' AND the pre-screening state. Anything
  // else is a no-op (the state is the guard against double-ordering).
  if (paymentStatus !== 'paid' || journey?.state !== 'intake_submitted') {
    return { paymentStatus, advancedToScreening: false, state: journey?.state ?? null };
  }

  await orderScreeningKit(admin, screening, accountId, corePatientId);
  const after = await getJourney(admin, accountId);
  return { paymentStatus, advancedToScreening: true, state: after?.state ?? null };
}

// The return-page entry point: finalise the in-flight treatment checkout (mark the
// pending session paid by reading the live provider status), then run the gate.
// Idempotent with the webhook and safe to call on every load of the return page.
export async function finaliseTreatmentCheckout(
  admin: SupabaseClient,
  payments: PaymentsAdapter,
  screening: ScreeningAdapter,
  accountId: string,
  corePatientId: string,
): Promise<TreatmentGateResult> {
  const ref = await getLatestPaymentRef(admin, accountId, 'treatment');
  if (ref?.provider_ref && ref.status !== 'paid' && ref.status !== 'refunded') {
    // Read the provider status; mark the pointer paid on completion.
    const result = await payments.getCheckoutStatus(ref.provider_ref);
    if (result.status === 'complete') {
      await setPaymentRefStatus(admin, ref.provider_ref, 'paid');
    }
  }
  return advanceOnTreatmentPaid(admin, screening, accountId, corePatientId);
}

// Convenience for the checkout surface: the paid/pending state for a product's
// payment kind (treatment C2 / consult C3).
export async function getProductCheckoutState(
  admin: SupabaseClient,
  accountId: string,
  product: Product,
): Promise<{ paid: boolean; pending: boolean; status: string | null }> {
  const ref = await getLatestPaymentRef(admin, accountId, product.kind);
  return { paid: ref?.status === 'paid', pending: ref?.status === 'pending', status: ref?.status ?? null };
}

// Convenience for the checkout surface: is there an unpaid pending treatment
// checkout in flight, or is treatment already paid?
export async function getTreatmentCheckoutState(
  admin: SupabaseClient,
  accountId: string,
): Promise<{ paid: boolean; pending: boolean; status: string | null }> {
  const ref = await getLatestPaymentRef(admin, accountId, 'treatment');
  const paid = await hasPaidTreatment(admin, accountId);
  return { paid, pending: ref?.status === 'pending', status: ref?.status ?? null };
}
