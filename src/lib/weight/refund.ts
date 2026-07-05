import type { SupabaseClient } from '@supabase/supabase-js';
import type { PaymentsAdapter } from '../adapters/payments';
import {
  getCheckoutConsentsBySession,
  getLatestPaymentRef,
  setPaymentRefStatus,
  setPaymentRefStatusById,
} from '../accounts';
import { PRODUCTS, type ProductId } from '../checkout/products';

// ===========================================================================
// Automatic refund-on-refusal (weight roadmap P4, extended for mixed baskets in
// shop S4). Weight / prescription is PAY-FIRST: the patient pays for treatment at
// checkout, BEFORE a clinician has decided. That is only acceptable because the
// refund is INSTANT and BUILT IN — not a manual back-office step. This is that
// path, in code, composed into the refuse branch of the clinician decision
// (decideClinicianAction / decideConsultAction), so no refusal can leave a paid
// patient un-refunded.
//
// TWO cases, one entry point:
//   * Weight P4 (a standalone pay-first treatment charge) -> FULL refund of the
//     treatment charge. Unchanged.
//   * Shop S4 (a MIXED basket: the prescription line rides the SAME single payment
//     as OTC lines) -> a PARTIAL refund of ONLY the prescription line's amount, so
//     the shipped OTC lines are NEVER refunded. Only the prescription (treatment)
//     pointer is flipped to 'refunded'; the basket-level pointer (the OTC portion)
//     stays 'paid'.
//
// No treatment payment (a menopause patient, or an unpaid patient) -> a no-op, so
// it is safe to call on every refusal.
// ===========================================================================
export async function refundOnRefusal(
  admin: SupabaseClient,
  payments: PaymentsAdapter,
  accountId: string,
): Promise<boolean> {
  const ref = await getLatestPaymentRef(admin, accountId, 'treatment');
  if (ref?.status !== 'paid' || !ref.provider_ref) {
    return false; // nothing paid up front -> nothing to refund
  }

  // Is this treatment charge part of a mixed basket? It is when the basket-level
  // payment shares the same provider session (shop S3 records the prescription line
  // as a 'treatment' pointer against the basket session).
  const basketRef = await getLatestPaymentRef(admin, accountId, 'basket');
  const isBasket = !!basketRef?.provider_ref && basketRef.provider_ref === ref.provider_ref;

  if (isBasket) {
    // Refund ONLY the prescription line's amount (partial). Shipped OTC is untouched.
    const amountMinor = await prescriptionRefundAmount(admin, accountId, ref.provider_ref);
    await payments.refund(ref.provider_ref, amountMinor ?? undefined);
    // Flip ONLY the treatment (prescription) pointer; the basket pointer stays paid.
    await setPaymentRefStatusById(admin, ref.id, 'refunded');
    return true;
  }

  // Standalone pay-first treatment (weight P4): full refund, unchanged.
  await payments.refund(ref.provider_ref);
  await setPaymentRefStatus(admin, ref.provider_ref, 'refunded');
  return true;
}

// The amount (in minor units, e.g. pence) to refund for the prescription line(s) of
// a basket session. Read from the checkout_consent rows captured against the session
// (which store the prescription product ids), priced from the catalogue descriptor —
// the amount is catalogue-derived at refund time, never stored in the app DB. Returns
// null when it cannot be determined (the caller then does a full refund fallback).
async function prescriptionRefundAmount(
  admin: SupabaseClient,
  accountId: string,
  session: string,
): Promise<number | null> {
  const consents = await getCheckoutConsentsBySession(admin, accountId, session);
  let total = 0;
  let found = false;
  for (const c of consents) {
    const product = PRODUCTS[c.product as ProductId];
    if (!product) continue;
    const minor = priceToMinor(product.price);
    if (minor != null) {
      total += minor;
      found = true;
    }
  }
  return found ? total : null;
}

// "£49" -> 4900. Returns null for a non-figure price (e.g. "£XX*").
function priceToMinor(price: string): number | null {
  const digits = price.replace(/[^0-9.]/g, '');
  if (!digits) return null;
  const pounds = Number(digits);
  return Number.isFinite(pounds) ? Math.round(pounds * 100) : null;
}
