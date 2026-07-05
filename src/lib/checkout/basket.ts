import type { SupabaseClient } from '@supabase/supabase-js';
import type { PaymentsAdapter } from '../adapters/payments';
import type { ScreeningAdapter } from '../adapters/screening';
import {
  getJourney,
  getLatestPaymentRef,
  recordCheckoutConsent,
  recordOtcDispatch,
  recordPaymentRef,
  setPaymentRefStatus,
} from '../accounts';
import { getOrCreateCustomer } from '../payments/billing';
import { advanceOnTreatmentPaid } from './checkout';
import { getProduct } from './products';
import { clearCart, getResolvedCart, type CartFlags, type ResolvedCartLine } from '../cart/cart';

// ===========================================================================
// Shop S3 — the unified checkout + FULFILMENT ROUTER (the hard part).
//
// A mixed basket pays ONCE (one provider payment for the whole basket, kind
// 'basket'). The router then routes each line by its TYPE:
//
//   * otc          -> mock DISPATCH immediately ("ships now"). No clinician, ever.
//                     Recorded in otc_fulfilment, tracked independently.
//   * prescription -> ENTER the existing clinician-reviewed journey, gated exactly
//                     as today: the treatment charge is recorded against the SAME
//                     basket session (so the built screening gate + the P4
//                     refund-on-refusal apply UNCHANGED), then advanceOnTreatmentPaid
//                     advances intake_submitted -> screening_kit_sent and NOTHING more.
//
// THE HARD LINE, load-bearing here (do not weaken):
//   * The basket payment gates OTC fulfilment + ENTRY to the prescription journey.
//     It NEVER reaches rx_issued. advanceOnTreatmentPaid stops at the screening
//     branch; a clinician still decides once the bloods are in (the screening
//     guard). rx_issued stays reachable ONLY from approved / consult_done.
//   * OTC lines never touch clinical state, never enter the journey.
//
// Idempotent throughout (return page + webhook both call finalise): OTC dispatch is
// upserted, the treatment ref is recorded once, the gate no-ops off intake_submitted,
// and the cart is cleared last (a re-poll finds it empty and does nothing).
// ===========================================================================

export interface BasketFulfilmentResult {
  // OTC catalogue slugs dispatched ("ships now") by this fulfilment.
  dispatchedOtc: string[];
  // True when a prescription line drove the journey into the screening branch.
  enteredScreening: boolean;
  // The journey state after fulfilment.
  state: string | null;
}

export interface BasketCheckoutResult extends BasketFulfilmentResult {
  paid: boolean;
}

// Start the single basket checkout. Creates ONE provider session for the whole
// basket, records the basket-level payment pointer (pending), and captures explicit
// clinical consent per PRESCRIPTION line (OTC needs none). Returns the hosted /
// mock checkout URL. The card is taken by the provider; the app DB sees only the
// session pointer + status + the consent records.
export async function startBasketCheckout(
  admin: SupabaseClient,
  payments: PaymentsAdapter,
  accountId: string,
  flags: CartFlags,
  returnUrl: string,
): Promise<string> {
  const cart = await getResolvedCart(admin, accountId, flags);
  if (cart.count === 0) throw new Error('startBasketCheckout: the basket is empty');

  const customerRef = await getOrCreateCustomer(admin, payments, accountId);
  const session = await payments.createCheckout('basket', accountId, returnUrl, customerRef);
  await recordPaymentRef(admin, accountId, 'basket', session.sessionId, 'pending');
  // Clinical consent is captured per prescription line, tied to the basket session.
  for (const line of cart.prescription) {
    await recordCheckoutConsent(admin, accountId, line.refId, session.sessionId);
  }
  return session.clientUrl;
}

// THE FULFILMENT ROUTER. Runs once the basket payment is paid: dispatch every OTC
// line, and enter the journey for the prescription line(s). Reads the live cart,
// fulfils, then clears it. Safe to call repeatedly.
export async function fulfilBasket(
  admin: SupabaseClient,
  payments: PaymentsAdapter,
  screening: ScreeningAdapter,
  accountId: string,
  corePatientId: string,
  flags: CartFlags,
  basketSession: string,
): Promise<BasketFulfilmentResult> {
  const cart = await getResolvedCart(admin, accountId, flags);
  const dispatchedOtc: string[] = [];
  let enteredScreening = false;

  // --- OTC lines: dispatch now, independent of any clinical state. ---
  for (const line of cart.otc) {
    await recordOtcDispatch(admin, accountId, line.refId, basketSession);
    dispatchedOtc.push(line.refId);
  }

  // --- Prescription lines: enter the existing clinician-reviewed journey. ---
  // The journey is single-track, so one treatment line drives it. Record the
  // per-line 'treatment' payment against the SAME basket session so the built
  // screening gate + the P4 refund-on-refusal apply unchanged, then run the gate.
  const treatmentLine = cart.prescription.find((l) => isTreatmentLine(l, flags));
  if (treatmentLine) {
    const existing = await getLatestPaymentRef(admin, accountId, 'treatment');
    if (!(existing?.status === 'paid' && existing.provider_ref === basketSession)) {
      await recordPaymentRef(admin, accountId, 'treatment', basketSession, 'paid');
    }
    const gate = await advanceOnTreatmentPaid(admin, screening, accountId, corePatientId);
    enteredScreening = gate.advancedToScreening;
  }

  // Cart handed to fulfilment / the journey; empty it (idempotent on re-poll).
  await clearCart(admin, accountId);

  const journey = await getJourney(admin, accountId);
  return { dispatchedOtc, enteredScreening, state: journey?.state ?? null };
}

// A prescription line whose product is the pay-first 'treatment' kind (the screen /
// weight programme — the journey entries the shop offers). Consult / medication are
// not basket-entry treatments, so they are not routed here.
function isTreatmentLine(line: ResolvedCartLine, flags: CartFlags): boolean {
  if (line.type !== 'prescription') return false;
  return getProduct(line.refId, flags)?.kind === 'treatment';
}

// The return-page entry point: finalise the in-flight basket checkout (mark the
// basket session paid by reading the live provider status), then run the router.
// Idempotent with the webhook; safe to call on every load of the return page.
export async function finaliseBasketCheckout(
  admin: SupabaseClient,
  payments: PaymentsAdapter,
  screening: ScreeningAdapter,
  accountId: string,
  corePatientId: string,
  flags: CartFlags,
): Promise<BasketCheckoutResult> {
  const ref = await getLatestPaymentRef(admin, accountId, 'basket');
  if (ref?.provider_ref && ref.status !== 'paid' && ref.status !== 'refunded') {
    const result = await payments.getCheckoutStatus(ref.provider_ref);
    if (result.status === 'complete') {
      await setPaymentRefStatus(admin, ref.provider_ref, 'paid');
    }
  }

  const after = await getLatestPaymentRef(admin, accountId, 'basket');
  const paid = after?.status === 'paid';
  if (paid && after?.provider_ref) {
    const fulfil = await fulfilBasket(
      admin,
      payments,
      screening,
      accountId,
      corePatientId,
      flags,
      after.provider_ref,
    );
    return { paid, ...fulfil };
  }

  const journey = await getJourney(admin, accountId);
  return { paid, dispatchedOtc: [], enteredScreening: false, state: journey?.state ?? null };
}
