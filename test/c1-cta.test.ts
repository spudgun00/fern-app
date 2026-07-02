import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_HREF,
  WAITLIST_LABEL,
  entryCta,
  flagsFromEnv,
  waitlistCta,
  type CtaFlags,
} from '../src/lib/cta';
import { RX_ISSUED_PREDECESSORS } from '../src/lib/journey/machine';
import { readEnv } from '../src/lib/env';

const WAITLIST_URL = 'https://fern.care/#join';

function flags(overrides: Partial<CtaFlags> = {}): CtaFlags {
  return { purchaseEnabled: false, weightLossRx: false, waitlistUrl: WAITLIST_URL, ...overrides };
}

// No CTA label may ever contain a medicine name (POM-safety, grep-enforced across
// the marketing site; belt-and-braces here too).
const DRUG_TERMS = /mounjaro|wegovy|ozempic|semaglutide|tirzepatide|glp-?1|injection|jab|\bpen\b/i;

describe('C1 entry-CTA switch', () => {
  describe('purchaseEnabled OFF (the pre-CQC default)', () => {
    it('menopause reads "Get early access" and routes to the waitlist', () => {
      const cta = entryCta('menopause', flags());
      expect(cta).toEqual({ label: WAITLIST_LABEL, href: WAITLIST_URL, purchase: false });
    });

    it('the weight door does not exist while weightLossRx is off (null, no copy)', () => {
      expect(entryCta('weight', flags())).toBeNull();
    });

    it('weight (weightLossRx on) also reads "Get early access" -> waitlist', () => {
      const cta = entryCta('weight', flags({ weightLossRx: true }));
      expect(cta).toEqual({ label: WAITLIST_LABEL, href: WAITLIST_URL, purchase: false });
    });

    it('no entry CTA routes into the purchase funnel', () => {
      expect(entryCta('menopause', flags())?.purchase).toBe(false);
      expect(entryCta('weight', flags({ weightLossRx: true }))?.purchase).toBe(false);
    });
  });

  describe('purchaseEnabled ON', () => {
    it('menopause reads "Start your health screen" and routes to account -> ID -> intake', () => {
      const cta = entryCta('menopause', flags({ purchaseEnabled: true }));
      expect(cta).toEqual({ label: 'Start your health screen', href: ACCOUNT_HREF, purchase: true });
      expect(ACCOUNT_HREF).toBe('/signup');
    });

    it('weight reads "Start your assessment" only when weightLossRx is ALSO on', () => {
      // purchase on but weightLossRx off -> weight door still does not exist.
      expect(entryCta('weight', flags({ purchaseEnabled: true }))).toBeNull();
      const cta = entryCta('weight', flags({ purchaseEnabled: true, weightLossRx: true }));
      expect(cta).toEqual({ label: 'Start your assessment', href: ACCOUNT_HREF, purchase: true });
    });
  });

  it('never emits a medicine name in any label, in any flag combination', () => {
    for (const purchaseEnabled of [false, true]) {
      for (const weightLossRx of [false, true]) {
        for (const door of ['menopause', 'weight'] as const) {
          const cta = entryCta(door, flags({ purchaseEnabled, weightLossRx }));
          if (cta) expect(cta.label).not.toMatch(DRUG_TERMS);
        }
      }
    }
    expect(waitlistCta(flags()).label).not.toMatch(DRUG_TERMS);
  });
});

describe('C1 flag parsing (readEnv)', () => {
  const base = {
    PUBLIC_SUPABASE_URL: 'x',
    PUBLIC_SUPABASE_ANON_KEY: 'x',
    SUPABASE_SERVICE_KEY: 'x',
  };

  it('defaults both flags OFF and the waitlist to the marketing site', () => {
    const env = readEnv({ ...base });
    expect(env.PURCHASE_ENABLED).toBe(false);
    expect(env.WEIGHTLOSS_RX_ENABLED).toBe(false);
    expect(env.WAITLIST_URL).toBe(WAITLIST_URL);
  });

  it('only the exact string "true" turns a flag on', () => {
    expect(readEnv({ ...base, PURCHASE_ENABLED: 'true' }).PURCHASE_ENABLED).toBe(true);
    expect(readEnv({ ...base, PURCHASE_ENABLED: 'TRUE' }).PURCHASE_ENABLED).toBe(true);
    expect(readEnv({ ...base, PURCHASE_ENABLED: '1' }).PURCHASE_ENABLED).toBe(false);
    expect(readEnv({ ...base, PURCHASE_ENABLED: 'yes' }).PURCHASE_ENABLED).toBe(false);
    expect(readEnv({ ...base, PURCHASE_ENABLED: '' }).PURCHASE_ENABLED).toBe(false);
  });

  it('flagsFromEnv mirrors the resolved env', () => {
    const env = readEnv({ ...base, PURCHASE_ENABLED: 'true', WEIGHTLOSS_RX_ENABLED: 'true' });
    expect(flagsFromEnv(env)).toEqual({
      purchaseEnabled: true,
      weightLossRx: true,
      // C6 added menopauseRx to the flag bag; unset here -> false (default off).
      menopauseRx: false,
      waitlistUrl: WAITLIST_URL,
    });
  });
});

describe('C1 does not touch the hard line', () => {
  it('RX_ISSUED_PREDECESSORS is still exactly approved + consult_done', () => {
    expect([...RX_ISSUED_PREDECESSORS].sort()).toEqual(['approved', 'consult_done']);
  });
});
