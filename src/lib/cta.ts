// C1: the purchase-CTA switch. ONE flag, `purchaseEnabled` (off by default,
// pre-CQC), decides what every entry CTA says and where it routes:
//   - OFF: "Get early access" -> the waitlist (marketing site). Locked, default.
//   - ON:  the purchase CTA   -> account -> ID -> intake (the purchase funnel).
//
// Weight is additionally gated by `weightLossRx` (mirrors the marketing site):
// with it OFF there is NO weight door and no "assessment" copy renders anywhere.
// No medicine names appear in any CTA label in either state.
//
// Pure + framework-free so the switch is unit-tested in isolation. Astro pages
// read the flags via `flagsFromEnv(Astro.locals.env)` and render the result.
import type { AppEnv } from './env';

export interface CtaFlags {
  purchaseEnabled: boolean;
  weightLossRx: boolean;
  waitlistUrl: string;
}

export interface Cta {
  label: string;
  href: string;
  /** true when this routes into the purchase funnel (account -> ID -> intake). */
  purchase: boolean;
}

export type FrontDoor = 'menopause' | 'weight';

export const WAITLIST_LABEL = 'Get early access';

// Entry into the funnel is account-first: signup, then ID, then intake. The
// onboarding flow is linear, so routing to /signup starts the whole chain (a
// signed-in patient is carried straight on to ID + intake by the onboarding
// redirects). No guest checkout (spec s10.8).
export const ACCOUNT_HREF = '/signup';

const PURCHASE_LABEL: Record<FrontDoor, string> = {
  menopause: 'Start your health screen',
  weight: 'Start your assessment',
};

export function flagsFromEnv(
  env: Pick<AppEnv, 'PURCHASE_ENABLED' | 'WEIGHTLOSS_RX_ENABLED' | 'WAITLIST_URL'>,
): CtaFlags {
  return {
    purchaseEnabled: env.PURCHASE_ENABLED,
    weightLossRx: env.WEIGHTLOSS_RX_ENABLED,
    waitlistUrl: env.WAITLIST_URL,
  };
}

// The waitlist CTA (the locked, pre-CQC default). Also the fallback shown on
// in-app purchase surfaces when the purchase funnel is off.
export function waitlistCta(flags: CtaFlags): Cta {
  return { label: WAITLIST_LABEL, href: flags.waitlistUrl, purchase: false };
}

// The entry CTA for a front door. Returns null for the weight door when
// weightLossRx is off (the door does not exist, so no copy leaks). The menopause
// door is always present.
export function entryCta(door: FrontDoor, flags: CtaFlags): Cta | null {
  if (door === 'weight' && !flags.weightLossRx) return null;
  if (!flags.purchaseEnabled) return waitlistCta(flags);
  return { label: PURCHASE_LABEL[door], href: ACCOUNT_HREF, purchase: true };
}
