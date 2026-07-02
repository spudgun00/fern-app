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

export type ProductId =
  | 'menopause_screen'
  | 'weight_treatment'
  | 'consult'
  | 'menopause_medication'
  | 'weight_medication'
  | 'addon_kit'
  | 'rescreen';

// A flag that gates a product's very existence: with it off getProduct returns
// null so no priced / drug-adjacent copy for that product renders anywhere. The
// weight door is gated by weightLossRx; the menopause medication (the C6 HRT
// layer) by menopauseRx. Screen / consult / add-ons are ungated (they never name
// a medicine), controlled only by the purchase funnel (purchaseEnabled).
export type ProductGate = 'weightLossRx' | 'menopauseRx';

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
  // full-lane booking (consult_booked). C5 adds 'medication' (Journey F, gates
  // rx_issued -> dispensing), 'addon_kit' + 'rescreen' (Journey G). The surface
  // branches on this. All product kinds are one-offs (membership is not a product
  // descriptor — it is the subscription, handled by billing.ts).
  kind: Exclude<CheckoutKind, 'membership'>;
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
  // The flag that gates this product's existence (see ProductGate). Undefined for
  // ungated products (screen, consult, add-ons).
  gatedBy?: ProductGate;
  // C5 (Journey F): this is a pass-through charge for a POM the clinician already
  // prescribed — it pays for dispensing, it does not prescribe. Drives the surface
  // copy ("passed through from our pharmacy partner"). Category-level only.
  passThrough?: boolean;
  // C5 (Journey G): a recurring charge cadence shown to the patient (e.g. the
  // 6/12-month re-screen). A display note only; the mock completes it as a one-off.
  recurringNote?: string;
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
    gatedBy: 'weightLossRx',
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
  },
  // Journey F — medication (menopause). A PASS-THROUGH charge for the treatment a
  // clinician has ALREADY prescribed: paying it arranges dispensing, it does not
  // prescribe. Gated behind menopauseRx (the C6 HRT layer) so no medicine copy
  // renders while it is off. Category-level only: never a medicine name. The price
  // is a single figure (VAT position is open decision #6 — do not add a VAT line).
  menopause_medication: {
    id: 'menopause_medication',
    door: 'menopause',
    kind: 'medication',
    title: 'Your prescribed treatment',
    price: '£XX*',
    framing:
      'The cost of the treatment your clinician has prescribed, passed through from our pharmacy partner. This arranges dispensing; it is not a new prescription.',
    lineItems: [
      {
        label: 'Your prescribed treatment (dispensed by our pharmacy partner)',
        note: 'passed through at cost',
      },
      {
        label: 'Prescriber fee',
        note: 'where applicable',
      },
    ],
    unlocks:
      'Once paid, your clinician-issued prescription is sent to our pharmacy partner for dispensing and delivery. Nothing about your prescription changes here.',
    gatedBy: 'menopauseRx',
    passThrough: true,
  },
  // Journey F — medication (weight). The weight-door counterpart, gated behind
  // weightLossRx so no medicine copy renders while that door is off. Same
  // pass-through, dispensing-only model; category-level copy only.
  weight_medication: {
    id: 'weight_medication',
    door: 'weight',
    kind: 'medication',
    title: 'Your prescribed treatment',
    price: '£XX*',
    framing:
      'The cost of the treatment your clinician has prescribed, passed through from our pharmacy partner. This arranges dispensing; it is not a new prescription.',
    lineItems: [
      {
        label: 'Your prescribed treatment (dispensed by our pharmacy partner)',
        note: 'passed through at cost',
      },
      {
        label: 'Prescriber fee',
        note: 'where applicable',
      },
    ],
    unlocks:
      'Once paid, your clinician-issued prescription is sent to our pharmacy partner for dispensing and delivery. Nothing about your prescription changes here.',
    gatedBy: 'weightLossRx',
    passThrough: true,
  },
  // Journey G — side-effect support kit. A one-off fulfilment line item (comfort
  // items for common early side effects). Ungated by any Rx flag (it names no
  // medicine); available only inside the purchase funnel. No clinical state is
  // touched by buying it.
  addon_kit: {
    id: 'addon_kit',
    door: 'both',
    kind: 'addon_kit',
    title: 'Side-effect support kit',
    price: '£25*',
    framing:
      'An optional kit of comfort items that can help with common early side effects. Not a medicine, and not required.',
    lineItems: [
      {
        label: 'Side-effect support kit',
        note: 'posted to you',
      },
    ],
    unlocks:
      'Once paid, we post your support kit. This is an optional extra; it changes nothing about your treatment or your care.',
  },
  // Journey G — 6/12-month re-screen. A RECURRING screen charge for ongoing
  // monitoring, reusing the screen product's framing. Ungated by any Rx flag (it
  // names no medicine); available only inside the purchase funnel. It records a
  // recurring monitoring charge and never touches the prescription path.
  rescreen: {
    id: 'rescreen',
    door: 'both',
    kind: 'rescreen',
    title: 'Repeat health screen',
    price: '£49*',
    framing:
      'A repeat at-home health screen for ongoing monitoring, every 6 to 12 months. A health screen, not a diagnosis.',
    lineItems: [
      {
        label: 'Repeat health screen (at-home blood test)',
        note: 'for ongoing monitoring',
      },
    ],
    unlocks:
      'This sets up your regular monitoring screen. A clinician reviews each result; nothing about your prescription changes here.',
    recurringNote: 'Billed every 6 to 12 months for ongoing monitoring.',
  },
};

// Resolve a product under the current flags. Returns null when:
//   * the id is unknown, or
//   * the product is gated by a flag (weightLossRx / menopauseRx) that is off, so
//     no drug-adjacent copy for that product ever leaks.
// The /checkout surface uses this: a null result renders the neutral waitlist /
// not-available state, never any priced or drug-adjacent copy. menopauseRx is
// optional in the flags arg so C2 call sites (which only pass weightLossRx) keep
// working; an absent flag reads as off, so a menopause-gated product stays hidden.
export function getProduct(
  id: string,
  flags: Pick<CtaFlags, 'weightLossRx'> & Partial<Pick<CtaFlags, 'menopauseRx'>>,
): Product | null {
  const product = (PRODUCTS as Record<string, Product>)[id];
  if (!product) return null;
  if (product.gatedBy && !flags[product.gatedBy]) return null;
  return product;
}
