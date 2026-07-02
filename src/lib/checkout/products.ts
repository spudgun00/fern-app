// ===========================================================================
// Checkout C2 — the product catalogue for the shared one-off checkout.
//
// One /checkout surface renders from a product DESCRIPTOR: the line items, the
// price, the framing, and what paying unlocks. Journeys A and B both go over the
// existing pay-first 'treatment' payment kind (so the built refund-on-refusal in
// P4 covers both), and both order the SAME shared screening kit on payment (the
// "one screening, two doors" model from weight P5). The descriptor is the ONLY
// thing that differs between them; the orchestration is identical.
//
// HARD LINES baked in here:
//   * NO medicine names, ever. Copy is category-level only. The weight product is
//     additionally gated behind weightLossRx: with it off getProduct returns null
//     so no "assessment"/treatment copy renders at all.
//   * The screen is NEVER "free" — it is framed "included / worth £X, credited to
//     treatment". A test asserts the word "free" appears in no descriptor.
//   * Journey A's post-approval treatment step has NO catalogue yet (that is C6):
//     the descriptor carries a labelled PLACEHOLDER, never a dummy drug name.
// ===========================================================================
import type { CheckoutKind } from '../adapters/payments';
import type { CtaFlags, FrontDoor } from '../cta';

export type ProductId = 'menopause_screen' | 'weight_treatment' | 'consult';

export interface LineItem {
  label: string;
  // A display sublabel (framing), e.g. "credited to treatment". Never a price.
  note?: string;
}

export interface Product {
  id: ProductId;
  door: FrontDoor | 'both';
  // C2 products (screen / weight) transmit through the pay-first one-off
  // 'treatment' kind (so the P4 refund covers them + the kit is ordered on pay).
  // C3 adds the 'consult' one-off (Journey C, ~£100), which instead gates the
  // full-lane booking (consult_booked). The surface branches on this.
  kind: Extract<CheckoutKind, 'treatment' | 'consult'>;
  title: string;
  // The real, single-figure price shown at checkout (working figures; the finance
  // /compliance pass locks them). Kept as a display string; the app DB never
  // stores an amount (payment_ref is a pointer + status only).
  price: string;
  // The one-line framing under the title. Screen framing only — never a diagnosis
  // claim, never "free".
  framing: string;
  lineItems: LineItem[];
  // What paying unlocks, in plain words (shown to set expectations before pay).
  unlocks: string;
  // Journey A only: the labelled placeholder for the post-approval treatment step
  // whose catalogue is not built until C6. Never a drug name.
  pendingTreatmentNote?: string;
  // True when this product is gated behind weightLossRx (the weight door).
  requiresRx: boolean;
}

// The working screen price (shared across both doors — it is the same Midlife
// Health Screen). Real, single-figure, credited to treatment.
const SCREEN_PRICE = '£49';

export const PRODUCTS: Record<ProductId, Product> = {
  // Journey A — screen-first (menopause). The Midlife Health Screen is the entry
  // purchase; the menopause treatment step after approval is C6 (placeholder).
  menopause_screen: {
    id: 'menopause_screen',
    door: 'menopause',
    kind: 'treatment',
    title: 'Midlife Health Screen',
    price: SCREEN_PRICE,
    framing: `An at-home health screen, worth ${SCREEN_PRICE} and credited to your treatment. A health screen, not a diagnosis.`,
    lineItems: [
      {
        label: 'Midlife Health Screen (at-home blood test)',
        note: `worth ${SCREEN_PRICE}, credited to your treatment`,
      },
    ],
    unlocks:
      'We post your at-home screening kit. Once your results are in, a clinician reviews them before any treatment is discussed.',
    pendingTreatmentNote:
      'Treatment step — pending menopause catalogue (phase C6). No treatment is chosen or charged here.',
    requiresRx: false,
  },
  // Journey B — treatment-first (weight), behind weightLossRx. The screen is
  // bundled and credited. Category-level copy only; no medicine names.
  weight_treatment: {
    id: 'weight_treatment',
    door: 'weight',
    kind: 'treatment',
    title: 'Weight and metabolic programme',
    price: SCREEN_PRICE,
    framing: `Your at-home health screen, worth ${SCREEN_PRICE} and included in your programme. A health screen, not a diagnosis.`,
    lineItems: [
      {
        label: 'Health screen (at-home blood test)',
        note: `included, worth ${SCREEN_PRICE}`,
      },
      {
        label: 'Clinician assessment of your results',
        note: 'a clinician reviews your screen before anything is prescribed',
      },
    ],
    unlocks:
      'We post your at-home screening kit. Once your results are in, a clinician reviews them and decides the safe next step. Nothing is prescribed without that review.',
    requiresRx: true,
  },
  // Journey C — the 1:1 video consultation (~£100), an upsell or, where the
  // compliance pass makes it mandatory, the required step to initiate treatment.
  // Door-agnostic; not gated by weightLossRx (no medicine names appear). Paying
  // it gates the full-lane booking (consult_booked), it does NOT prescribe.
  consult: {
    id: 'consult',
    door: 'both',
    kind: 'consult',
    title: 'Consultation with a clinician',
    price: '£100',
    framing: 'A one-to-one video consultation with a clinician to assess your care.',
    lineItems: [
      {
        label: 'Video consultation with a clinician',
        note: 'a clinician assesses your care and decides the safe next step',
      },
    ],
    unlocks:
      'Once paid, you can book your consultation slot. The clinician decides the next step at the consult. Nothing is prescribed without that assessment.',
    requiresRx: false,
  },
};

// Resolve a product under the current flags. Returns null when:
//   * the id is unknown, or
//   * the product needs weightLossRx and it is off (so no weight-door copy leaks).
// The /checkout surface uses this: a null result renders the neutral waitlist /
// not-available state, never any priced or drug-adjacent copy.
export function getProduct(id: string, flags: Pick<CtaFlags, 'weightLossRx'>): Product | null {
  const product = (PRODUCTS as Record<string, Product>)[id];
  if (!product) return null;
  if (product.requiresRx && !flags.weightLossRx) return null;
  return product;
}
