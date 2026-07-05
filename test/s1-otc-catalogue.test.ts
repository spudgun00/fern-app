import { describe, expect, it } from 'vitest';
import {
  OTC_CATEGORIES,
  OTC_PRODUCTS,
  PLACEHOLDER_CATALOGUE,
  getOtcCatalogue,
  getOtcProduct,
  isCategoryEnabled,
  isKnownOtcProductId,
  type OtcCategory,
  type OtcFlags,
} from '../src/data/otc-catalogue';
import { flagsFromEnv } from '../src/lib/cta';
import { readEnv } from '../src/lib/env';

// ===========================================================================
// Shop S1 — the OTC catalogue data source. Pure (no DB): the flag gating, the
// compliance discipline (authorised claims only, no POM), and the placeholder
// discipline. The app is output:'server', so the flag-off "no OTC copy" proof is
// a getter/render-data proof here, NOT a dist grep.
// ===========================================================================

const ALL_CATEGORY_IDS: OtcCategory[] = [
  'intimate-vaginal',
  'menopause-supplements',
  'bone-muscle',
  'heart-brain',
  'energy-focus',
  'sleep-calm',
  'skin-hair',
  'gut-general',
];

function flags(over: Partial<OtcFlags> = {}): OtcFlags {
  return { otcShop: false, otcCategories: [], ...over };
}

const allOn = (): OtcFlags => ({ otcShop: true, otcCategories: [...ALL_CATEGORY_IDS] });

// The forbidden marketing verbs (§4): a supplement may never claim to treat /
// cure / balance / boost, nor claim a condition. Applied to every rendered field.
const FORBIDDEN_CLAIM = /\b(treat|treats|treating|cure|cures|balance|balances|boost|boosts)\b/i;
// POM / prescription-only actives that must NOT appear in an OTC line (melatonin
// is prescription-only in the UK; hormonal actives are POM).
const POM_DENYLIST = /melatonin|oestrogen|estrogen|estradiol|progesterone|testosterone|hrt/i;

describe('S1 catalogue shape + placeholder discipline', () => {
  it('the whole set is a PLACEHOLDER and every line is placeholder:true', () => {
    expect(PLACEHOLDER_CATALOGUE).toBe(true);
    for (const p of OTC_PRODUCTS) {
      expect(p.placeholder, `${p.id} must be placeholder`).toBe(true);
    }
  });

  it('every category is represented, in the eight expected groups', () => {
    expect(OTC_CATEGORIES.map((c) => c.id).sort()).toEqual([...ALL_CATEGORY_IDS].sort());
    for (const cat of ALL_CATEGORY_IDS) {
      expect(OTC_PRODUCTS.some((p) => p.category === cat), `${cat} has no products`).toBe(true);
    }
  });

  it('every line has a real price and a factual description; flag == category', () => {
    for (const p of OTC_PRODUCTS) {
      expect(p.price, `${p.id} has no price`).toMatch(/£/);
      expect(p.patientDescription.length, `${p.id} has no description`).toBeGreaterThan(10);
      expect(p.flag, `${p.id} flag != category`).toBe(p.category);
    }
  });
});

describe('S1 compliance discipline (authorised claims only, no POM)', () => {
  it('no line uses a treat / cure / balance / boost claim in any field', () => {
    for (const p of OTC_PRODUCTS) {
      const blob = `${p.name} ${p.patientDescription} ${p.authorisedClaims.join(' ')}`;
      expect(blob, `${p.id} uses a forbidden claim verb`).not.toMatch(FORBIDDEN_CLAIM);
    }
  });

  it('every authorised claim is register-worded ("contribute(s) to" / "needed for" / "role")', () => {
    for (const p of OTC_PRODUCTS) {
      for (const claim of p.authorisedClaims) {
        expect(claim, `${p.id} claim not register-worded: ${claim}`).toMatch(
          /contributes? to|is needed for|has a role|maintenance of normal/i,
        );
      }
    }
  });

  it('no POM / prescription-only active appears in any PATIENT-FACING OTC line (no melatonin, no hormones)', () => {
    // Scoped to the patient-facing fields only. The internal complianceFlag notes
    // deliberately reference POM / hormonal actives ("phytoestrogens", "hormonal")
    // to document the boundary; those are governance text, never shown to a buyer.
    for (const p of OTC_PRODUCTS) {
      const patientFacing = `${p.id} ${p.name} ${p.patientDescription} ${p.authorisedClaims.join(' ')}`;
      expect(patientFacing, `${p.id} names a POM active in patient-facing copy`).not.toMatch(
        POM_DENYLIST,
      );
    }
  });

  it('the sleep category carries no authorised "sleep" claim (no authorised sleep claim exists)', () => {
    const sleep = OTC_PRODUCTS.filter((p) => p.category === 'sleep-calm');
    expect(sleep.length).toBeGreaterThan(0);
    for (const p of sleep) {
      for (const claim of p.authorisedClaims) {
        expect(claim.toLowerCase(), `${p.id} claims sleep`).not.toContain('sleep');
      }
    }
  });
});

describe('S1 flag gating (master + per-category, all off by default)', () => {
  it('flags OFF -> the catalogue is empty and no product resolves', () => {
    expect(getOtcCatalogue(flags())).toEqual([]);
    for (const p of OTC_PRODUCTS) {
      expect(getOtcProduct(p.id, flags()), `${p.id} resolved while shop off`).toBeNull();
    }
  });

  it('master ON but a category NOT in the allowlist -> that category is absent', () => {
    const oneOn = flags({ otcShop: true, otcCategories: ['bone-muscle'] });
    const groups = getOtcCatalogue(oneOn);
    expect(groups.map((g) => g.category.id)).toEqual(['bone-muscle']);
    // A product from an off category does not resolve; a bone-muscle one does.
    expect(getOtcProduct('omega-3', oneOn)).toBeNull();
    expect(getOtcProduct('vitamin-d3', oneOn)?.id).toBe('vitamin-d3');
    expect(isCategoryEnabled('heart-brain', oneOn)).toBe(false);
    expect(isCategoryEnabled('bone-muscle', oneOn)).toBe(true);
  });

  it('master OFF ignores the allowlist entirely (nothing renders)', () => {
    const masterOff = flags({ otcShop: false, otcCategories: [...ALL_CATEGORY_IDS] });
    expect(getOtcCatalogue(masterOff)).toEqual([]);
    expect(getOtcProduct('vitamin-d3', masterOff)).toBeNull();
  });

  it('all ON -> every category renders with its products, prices and factual claims', () => {
    const groups = getOtcCatalogue(allOn());
    expect(groups.map((g) => g.category.id).sort()).toEqual([...ALL_CATEGORY_IDS].sort());
    const total = groups.reduce((n, g) => n + g.products.length, 0);
    expect(total).toBe(OTC_PRODUCTS.length);
    for (const g of groups) {
      for (const p of g.products) {
        expect(p.price).toMatch(/£/);
      }
    }
  });

  it('getOtcProduct rejects an unknown id even with everything on', () => {
    expect(getOtcProduct('not-a-real-line', allOn())).toBeNull();
    expect(isKnownOtcProductId('vitamin-d3')).toBe(true);
    expect(isKnownOtcProductId('not-a-real-line')).toBe(false);
  });
});

describe('S1 flagsFromEnv parses the OTC flags', () => {
  it('defaults: shop off, no categories (readEnv over the ambient env)', () => {
    const f = flagsFromEnv({ ...readEnv(), OTC_SHOP_ENABLED: false, OTC_CATEGORIES: '' });
    expect(f.otcShop).toBe(false);
    expect(f.otcCategories).toEqual([]);
  });

  it('parses OTC_CATEGORIES into a trimmed, non-empty id list', () => {
    const f = flagsFromEnv({
      ...readEnv(),
      OTC_SHOP_ENABLED: true,
      OTC_CATEGORIES: 'bone-muscle, heart-brain ,, skin-hair',
    });
    expect(f.otcShop).toBe(true);
    expect(f.otcCategories).toEqual(['bone-muscle', 'heart-brain', 'skin-hair']);
  });
});
