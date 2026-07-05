import type { SupabaseClient } from '@supabase/supabase-js';
import type { CtaFlags } from '../cta';
import { getOtcProduct, type OtcProduct } from '../../data/otc-catalogue';
import { getProduct, type Product } from '../checkout/products';

// ===========================================================================
// Shop S2 — the unified cart. ONE basket per patient holding TYPED line items:
//
//   * type 'otc'          — a food-supplement / intimate-care product from the OTC
//     catalogue. Fulfilment: "Ships now" (mock dispatch on payment, no clinician).
//   * type 'prescription' — a treatment product (screen / weight programme /
//     consult / medication) that enters the clinician-reviewed journey. Fulfilment:
//     "Pending clinician review".
//
// The cart is a set of NON-CLINICAL pointer rows (account + line_type + a catalogue
// slug). Product name / price / description are resolved from the FLAG-GATED
// catalogues at render, never stored. A prescription line is ENTRY to the journey
// only — it carries no script, no decision, no clinical state (S3 gates it exactly
// as the checkout does today). S2 adds NO checkout change: this is the cart itself.
//
// THE HARD LINE (held from here on): a cart line is never near rx_issued. An OTC
// line never touches clinical state. Adding / holding a prescription line changes
// nothing about the guard — a clinician still decides once it reaches review (S3).
// ===========================================================================

export type CartLineType = 'otc' | 'prescription';

export type Fulfilment = 'ships-now' | 'pending-review';

export interface CartItem {
  id: string;
  account_id: string;
  line_type: CartLineType;
  ref_id: string;
  created_at: string;
}

// A cart line resolved for display against the current flags. Only lines whose
// product still resolves under the flags are returned (a flag turned off hides its
// lines, mirroring the catalogue getters).
export interface ResolvedCartLine {
  id: string;
  type: CartLineType;
  refId: string;
  name: string;
  price: string;
  fulfilment: Fulfilment;
  fulfilmentLabel: string;
}

// The fulfilment route for a line type — a PURE function, the heart of the basket
// model: OTC ships now (no clinician, ever); a prescription line is pending a
// clinician review. S3's router acts on exactly this split.
export function fulfilmentFor(type: CartLineType): Fulfilment {
  return type === 'otc' ? 'ships-now' : 'pending-review';
}

export function fulfilmentLabel(fulfilment: Fulfilment): string {
  return fulfilment === 'ships-now' ? 'Ships now' : 'Pending clinician review';
}

// The flags the cart resolution reads: the OTC gates + the prescription-product
// gates (getProduct needs weightLossRx / menopauseRx; getOtcProduct needs the OTC
// flags). The whole CtaFlags bag satisfies both.
export type CartFlags = Pick<
  CtaFlags,
  'otcShop' | 'otcCategories' | 'weightLossRx' | 'menopauseRx'
>;

// ---------------------------------------------------------------------------
// CRUD (non-clinical pointer rows).
// ---------------------------------------------------------------------------

export async function listCartItems(
  db: SupabaseClient,
  accountId: string,
): Promise<CartItem[]> {
  const { data, error } = await db
    .from('cart_item')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`listCartItems: ${error.message}`);
  return (data as CartItem[]) ?? [];
}

// Add a typed line. Idempotent by (account, type, ref): re-adding an existing line
// is a no-op (the unique index + ignoreDuplicates upsert). Returns nothing; the
// caller re-reads the cart. NOTE the ref_id is validated against the flag-gated
// catalogue by the route BEFORE this is called, so an off/unknown line cannot enter.
export async function addCartItem(
  db: SupabaseClient,
  accountId: string,
  type: CartLineType,
  refId: string,
): Promise<void> {
  const { error } = await db
    .from('cart_item')
    .upsert(
      { account_id: accountId, line_type: type, ref_id: refId },
      { onConflict: 'account_id,line_type,ref_id', ignoreDuplicates: true },
    );
  if (error) throw new Error(`addCartItem: ${error.message}`);
}

// Remove a single line by its id (scoped to the account, so one patient cannot
// remove another's line).
export async function removeCartItem(
  db: SupabaseClient,
  accountId: string,
  lineId: string,
): Promise<void> {
  const { error } = await db
    .from('cart_item')
    .delete()
    .eq('id', lineId)
    .eq('account_id', accountId);
  if (error) throw new Error(`removeCartItem: ${error.message}`);
}

// Empty the cart (used by S3 after a successful checkout hands the lines to
// fulfilment / the journey).
export async function clearCart(db: SupabaseClient, accountId: string): Promise<void> {
  const { error } = await db.from('cart_item').delete().eq('account_id', accountId);
  if (error) throw new Error(`clearCart: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Resolution (catalogue lookup + labelling), flag-gated.
// ---------------------------------------------------------------------------

// Resolve a single stored line to its display form under the flags, or null if its
// product no longer resolves (flag off / unknown id) — the line is then hidden.
export function resolveCartLine(item: CartItem, flags: CartFlags): ResolvedCartLine | null {
  if (item.line_type === 'otc') {
    const product: OtcProduct | null = getOtcProduct(item.ref_id, flags);
    if (!product) return null;
    const fulfilment = fulfilmentFor('otc');
    return {
      id: item.id,
      type: 'otc',
      refId: item.ref_id,
      name: product.name,
      price: product.price,
      fulfilment,
      fulfilmentLabel: fulfilmentLabel(fulfilment),
    };
  }
  // prescription: a treatment product descriptor (products.ts), flag-gated.
  const product: Product | null = getProduct(item.ref_id, flags);
  if (!product) return null;
  const fulfilment = fulfilmentFor('prescription');
  return {
    id: item.id,
    type: 'prescription',
    refId: item.ref_id,
    name: product.title,
    price: product.price,
    fulfilment,
    fulfilmentLabel: fulfilmentLabel(fulfilment),
  };
}

export interface ResolvedCart {
  lines: ResolvedCartLine[];
  otc: ResolvedCartLine[];
  prescription: ResolvedCartLine[];
  count: number;
  hasOtc: boolean;
  hasPrescription: boolean;
  isMixed: boolean;
}

// The full cart resolved + grouped by fulfilment for display. Lines whose product
// does not resolve under the flags are dropped (not shown).
export async function getResolvedCart(
  db: SupabaseClient,
  accountId: string,
  flags: CartFlags,
): Promise<ResolvedCart> {
  const items = await listCartItems(db, accountId);
  const lines = items
    .map((i) => resolveCartLine(i, flags))
    .filter((l): l is ResolvedCartLine => l !== null);
  const otc = lines.filter((l) => l.type === 'otc');
  const prescription = lines.filter((l) => l.type === 'prescription');
  return {
    lines,
    otc,
    prescription,
    count: lines.length,
    hasOtc: otc.length > 0,
    hasPrescription: prescription.length > 0,
    isMixed: otc.length > 0 && prescription.length > 0,
  };
}
