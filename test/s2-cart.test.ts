import { afterAll, describe, expect, it } from 'vitest';
import { readEnv } from '../src/lib/env';
import { createAdminClient } from '../src/lib/supabase/admin';
import { ensureAccount } from '../src/lib/accounts';
import {
  addCartItem,
  clearCart,
  fulfilmentFor,
  fulfilmentLabel,
  getResolvedCart,
  listCartItems,
  removeCartItem,
  resolveCartLine,
  type CartFlags,
  type CartItem,
} from '../src/lib/cart/cart';

// ===========================================================================
// Shop S2 — the unified cart. The success test: a cart can hold OTC and
// prescription lines TOGETHER, each correctly typed and labelled. No checkout
// change (that is S3); this proves the basket model + the fulfilment split.
// ===========================================================================

const env = { ...readEnv(), CORE_IMPL: 'mock' };
const admin = createAdminClient(env);
const createdAccounts: string[] = [];

afterAll(async () => {
  if (createdAccounts.length === 0) return;
  await admin.from('cart_item').delete().in('account_id', createdAccounts);
  await admin.from('account').delete().in('id', createdAccounts);
});

async function freshPatient(): Promise<string> {
  const account = await ensureAccount(admin, crypto.randomUUID());
  createdAccounts.push(account.id);
  return account.id;
}

// Flags with the OTC shop on (a couple of categories) + the treatment products
// resolvable, so both a genuine OTC line and a genuine prescription line resolve.
const flags: CartFlags = {
  otcShop: true,
  otcCategories: ['bone-muscle', 'sleep-calm'],
  weightLossRx: true,
  menopauseRx: true,
};

describe('S2 fulfilment split (pure)', () => {
  it('otc -> ships-now / "Ships now"; prescription -> pending-review / "Pending clinician review"', () => {
    expect(fulfilmentFor('otc')).toBe('ships-now');
    expect(fulfilmentFor('prescription')).toBe('pending-review');
    expect(fulfilmentLabel('ships-now')).toBe('Ships now');
    expect(fulfilmentLabel('pending-review')).toBe('Pending clinician review');
  });

  it('resolveCartLine labels each type and reads the catalogue name + price', () => {
    const otcItem: CartItem = {
      id: 'x1', account_id: 'a', line_type: 'otc', ref_id: 'vitamin-d3', created_at: '',
    };
    const rxItem: CartItem = {
      id: 'x2', account_id: 'a', line_type: 'prescription', ref_id: 'menopause_screen', created_at: '',
    };
    const otc = resolveCartLine(otcItem, flags);
    const rx = resolveCartLine(rxItem, flags);
    expect(otc).toMatchObject({ type: 'otc', name: 'Vitamin D3', fulfilment: 'ships-now', fulfilmentLabel: 'Ships now' });
    expect(otc!.price).toMatch(/£/);
    expect(rx).toMatchObject({ type: 'prescription', fulfilment: 'pending-review', fulfilmentLabel: 'Pending clinician review' });
    expect(rx!.name).toBe('Midlife Health Screen');
  });

  it('a line whose product does not resolve under the flags is hidden (returns null)', () => {
    // OTC line whose category is not enabled.
    const offCat: CartItem = {
      id: 'x3', account_id: 'a', line_type: 'otc', ref_id: 'omega-3', created_at: '',
    };
    expect(resolveCartLine(offCat, flags)).toBeNull();
    // A prescription line gated by a flag that is off.
    const rxOff: CartItem = {
      id: 'x4', account_id: 'a', line_type: 'prescription', ref_id: 'weight_treatment', created_at: '',
    };
    expect(resolveCartLine(rxOff, { ...flags, weightLossRx: false })).toBeNull();
  });
});

describe('S2 the cart holds OTC + prescription lines together, typed + labelled', () => {
  it('add both -> the resolved cart is mixed, grouped by fulfilment', { timeout: 60_000 }, async () => {
    const accountId = await freshPatient();

    await addCartItem(admin, accountId, 'otc', 'vitamin-d3');
    await addCartItem(admin, accountId, 'otc', 'magnesium-glycinate');
    await addCartItem(admin, accountId, 'prescription', 'menopause_screen');

    const cart = await getResolvedCart(admin, accountId, flags);
    expect(cart.count).toBe(3);
    expect(cart.hasOtc).toBe(true);
    expect(cart.hasPrescription).toBe(true);
    expect(cart.isMixed).toBe(true);

    // Every OTC line is typed otc + labelled "Ships now".
    expect(cart.otc).toHaveLength(2);
    for (const l of cart.otc) {
      expect(l.type).toBe('otc');
      expect(l.fulfilmentLabel).toBe('Ships now');
    }
    // The prescription line is typed prescription + labelled "Pending clinician review".
    expect(cart.prescription).toHaveLength(1);
    expect(cart.prescription[0].type).toBe('prescription');
    expect(cart.prescription[0].fulfilmentLabel).toBe('Pending clinician review');
    expect(cart.prescription[0].name).toBe('Midlife Health Screen');
  });

  it('adding the same line twice is idempotent (no duplicate row)', { timeout: 60_000 }, async () => {
    const accountId = await freshPatient();
    await addCartItem(admin, accountId, 'otc', 'vitamin-d3');
    await addCartItem(admin, accountId, 'otc', 'vitamin-d3');
    expect((await listCartItems(admin, accountId)).length).toBe(1);
  });

  it('remove + clear work per account', { timeout: 60_000 }, async () => {
    const accountId = await freshPatient();
    await addCartItem(admin, accountId, 'otc', 'vitamin-d3');
    await addCartItem(admin, accountId, 'prescription', 'menopause_screen');
    const items = await listCartItems(admin, accountId);
    expect(items.length).toBe(2);

    await removeCartItem(admin, accountId, items[0].id);
    expect((await listCartItems(admin, accountId)).length).toBe(1);

    await clearCart(admin, accountId);
    expect((await listCartItems(admin, accountId)).length).toBe(0);
  });

  it('with the OTC shop off, stored OTC lines are hidden but prescription lines remain', { timeout: 60_000 }, async () => {
    const accountId = await freshPatient();
    await addCartItem(admin, accountId, 'otc', 'vitamin-d3');
    await addCartItem(admin, accountId, 'prescription', 'menopause_screen');

    const offFlags: CartFlags = { ...flags, otcShop: false };
    const cart = await getResolvedCart(admin, accountId, offFlags);
    // The OTC line does not resolve (shop off); the prescription line still does.
    expect(cart.hasOtc).toBe(false);
    expect(cart.hasPrescription).toBe(true);
    expect(cart.count).toBe(1);
  });
});
