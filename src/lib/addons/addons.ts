import type { SupabaseClient } from '@supabase/supabase-js';
import type { PaymentsAdapter } from '../adapters/payments';
import type { PaymentKind } from '../accounts';
import { getLatestPaymentRef, setPaymentRefStatus } from '../accounts';

// ===========================================================================
// Checkout C5 — Journey G (add-ons). Two optional purchases that ride the shared
// checkout surface + the pay-first one-off machinery, but touch NO clinical state
// and NO prescription path:
//   * 'addon_kit' — a one-off side-effect support kit (a fulfilment line item).
//   * 'rescreen'  — a recurring 6/12-month monitoring re-screen (reuses the screen
//     product's framing). Recurring cadence is a display note; the mock completes
//     it as a one-off.
//
// Both are gated by purchaseEnabled only (no Rx flag, no medicine names). Buying
// one records a payment_ref pointer + a checkout_consent row (both via the shared
// startProductCheckout) and NOTHING else: no journey transition, no script, no
// dispense. The journey state after an add-on purchase is unchanged — asserted.
// ===========================================================================

// The Journey-G add-on payment kinds (a subset of PaymentKind), kept explicit so
// the finalise below cannot be pointed at a clinical/treatment charge by mistake.
export type AddonKind = Extract<PaymentKind, 'addon_kit' | 'rescreen'>;

export interface AddonFinaliseResult {
  kind: AddonKind;
  paid: boolean;
}

// The return-page entry point: mark the in-flight add-on checkout of this kind
// paid by reading the live provider status. It records the fulfilment/recurring
// line (the payment_ref flips to paid) and does nothing clinical — there is no
// journey transition here by construction. Idempotent; safe to call on every load.
export async function finaliseAddonCheckout(
  admin: SupabaseClient,
  payments: PaymentsAdapter,
  accountId: string,
  kind: AddonKind,
): Promise<AddonFinaliseResult> {
  const ref = await getLatestPaymentRef(admin, accountId, kind);
  if (ref?.provider_ref && ref.status !== 'paid' && ref.status !== 'refunded') {
    const result = await payments.getCheckoutStatus(ref.provider_ref);
    if (result.status === 'complete') {
      await setPaymentRefStatus(admin, ref.provider_ref, 'paid');
    }
  }
  const after = await getLatestPaymentRef(admin, accountId, kind);
  return { kind, paid: after?.status === 'paid' };
}
