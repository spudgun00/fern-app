// Reads the app's environment. On the Cloudflare Workers runtime, env arrives
// via `Astro.locals.runtime.env`; in local dev and in Vitest it comes from
// `process.env` (the adapter loads .dev.vars into process.env at build/dev, and
// the test setup loads .dev.vars too). runtimeEnv takes precedence.
//
// SUPABASE_SERVICE_KEY is server-only. It is never PUBLIC_ and must never reach
// any client-exposed code.
export interface AppEnv {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_KEY: string;
  CORE_IMPL: string;
  DISPENSING_IMPL: string;
  IDENTITY_IMPL: string;
  PAYMENTS_IMPL: string;
  BOOKING_IMPL: string;
  VIDEO_IMPL: string;
  EMAIL_IMPL: string;
  SCREENING_IMPL: string;
  // Stripe Identity (test mode in P1). Required ONLY when IDENTITY_IMPL=stripe;
  // server-only, never PUBLIC_, never in a client bundle.
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  // Stripe Checkout + Billing (test mode in P5). Required ONLY when
  // PAYMENTS_IMPL=stripe. STRIPE_SECRET_KEY is shared with the Identity path
  // (same Stripe account). The price ids are test-mode price ids; the billing
  // webhook secret is the signing secret of the billing webhook endpoint. All
  // server-only, never PUBLIC_, never in a client bundle.
  STRIPE_PRICE_CONSULT?: string;
  STRIPE_PRICE_MEMBERSHIP?: string;
  STRIPE_BILLING_WEBHOOK_SECRET?: string;
  // Cal.com booking (test mode in P6). Required ONLY when BOOKING_IMPL=calcom.
  // CALCOM_EVENT_TYPE_ID is the consult event type to book; the webhook secret is
  // the signing secret of the Cal.com webhook endpoint. Server-only, never PUBLIC_.
  CALCOM_API_KEY?: string;
  CALCOM_EVENT_TYPE_ID?: string;
  CALCOM_BOOKING_URL?: string; // the public booking page base, e.g. https://cal.com/fern/consult
  CALCOM_WEBHOOK_SECRET?: string;
  // Daily video (test mode in P6). Required ONLY when VIDEO_IMPL=daily.
  // DAILY_DOMAIN is the *.daily.co subdomain rooms are created under. Server-only.
  DAILY_API_KEY?: string;
  DAILY_DOMAIN?: string;
  // Transactional email (D5). Required ONLY when EMAIL_IMPL=resend. RESEND_API_KEY
  // is a server-only secret (never PUBLIC_). EMAIL_FROM is the verified Resend
  // sender, a subdomain of fern.care (default `Fern <noreply@mail.fern.care>`) so
  // the app's email DNS stays isolated from the Brevo waitlist mail on the apex.
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  // C1 purchase-CTA switch. PURCHASE_ENABLED is OFF by default (pre-CQC): every
  // entry CTA reads "Get early access" and routes to the waitlist. Flip it on
  // (post CQC + clinical lead + compliance sign-off) and the entry CTAs become
  // the purchase funnel (account -> ID -> intake). WEIGHTLOSS_RX_ENABLED
  // additionally gates the weight door (mirrors the marketing site) so no
  // "assessment" copy renders while it is off. WAITLIST_URL is where the
  // "Get early access" CTA routes (the marketing-site waitlist). Non-secret vars.
  PURCHASE_ENABLED: boolean;
  WEIGHTLOSS_RX_ENABLED: boolean;
  // Checkout C6 — the menopause HRT treatment layer switch. MENOPAUSE_RX_ENABLED
  // is OFF by default (pre-CQC), the exact mirror of WEIGHTLOSS_RX_ENABLED for the
  // menopause door: with it OFF the HRT catalogue does not resolve and NO HRT
  // product name / type renders anywhere (the Journey-A treatment step shows the
  // labelled C6 placeholder instead). Flip it on (post CQC + clinical lead +
  // compliance sign-off) and the treatment step renders the real catalogue +
  // contraindication intake. It never weakens the hard line: choosing a treatment
  // is a preference only; a clinician still issues every script. Non-secret var.
  MENOPAUSE_RX_ENABLED: boolean;
  // Shop S1 — the OTC / women's-wellbeing shop. OFF by default. OTC_SHOP_ENABLED
  // is the master switch: with it off no OTC catalogue name / claim / price
  // renders anywhere. OTC_CATEGORIES is a comma-separated allowlist of the
  // OTC category ids that are switched on (e.g. "bone-muscle,heart-brain"), so
  // production can clear and turn on categories one at a time as their copy
  // passes compliance. A category renders only when the master is on AND it is in
  // this list. Empty by default (no category on). Both non-secret vars.
  OTC_SHOP_ENABLED: boolean;
  OTC_CATEGORIES: string;
  WAITLIST_URL: string;
  // Checkout C5 — the medication (Journey F) billing model. Open decision #4 in
  // the checkout spec: the POM is a pass-through (CloudRx) charge that can be
  // billed EITHER as a separate per-fill charge ('per_fill', the default —
  // dispensing waits for the medication payment) OR bundled into the membership
  // ('bundled' — no separate charge; an active member's dispensing proceeds). Kept
  // as a flag so the pricing model decides it WITHOUT a code change; never
  // hard-coded. Non-secret var. It never weakens the hard line: either way a
  // clinician issues every script, and the charge gates rx_issued -> dispensing
  // only (never rx_issued itself).
  MEDICATION_BILLING: 'per_fill' | 'bundled';
  // Checkout C3 — the GLP initiation routing switch. Whether a weight (GLP)
  // patient whose screening is in must have a 1:1 CONSULT to initiate treatment
  // (true), or may be initiated ASYNC on a clinician's sign-off of the bloods
  // (false, the default base tier). A compliance-pass decision, kept as a flag so
  // it flips WITHOUT a rewrite. It never weakens the hard line: either way a
  // clinician makes the prescribing decision. Non-secret var, default OFF (async).
  GLP_CONSULT_REQUIRED: boolean;
  // Phase D — the outer demo password gate (shared with the marketing site across
  // *.fern.care). When set, the middleware locks every route behind a password
  // page (except the gate page + webhooks); when unset the gate is DISABLED so
  // local dev + tests run unchallenged. A server-only secret (set via
  // `wrangler secret put PREVIEW_PASS`), never PUBLIC_. Entirely separate from
  // Supabase patient auth. See src/lib/preview-gate.ts.
  PREVIEW_PASS?: string;
}

const DEFAULT_EMAIL_FROM = 'Fern <noreply@mail.fern.care>';
const DEFAULT_WAITLIST_URL = 'https://fern.care/#join';

const REQUIRED = [
  'PUBLIC_SUPABASE_URL',
  'PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_KEY',
] as const;

export function readEnv(runtimeEnv?: Record<string, unknown>): AppEnv {
  const processEnv: Record<string, unknown> =
    typeof process !== 'undefined' && process.env ? process.env : {};

  // Look up each key individually (the cloudflare:workers `env` binding is a
  // proxy that does not always enumerate via spread). runtimeEnv wins.
  const get = (key: string): unknown => {
    const fromRuntime = runtimeEnv ? runtimeEnv[key] : undefined;
    return fromRuntime != null ? fromRuntime : processEnv[key];
  };

  for (const key of REQUIRED) {
    if (!get(key)) {
      throw new Error(`Missing required env var: ${key}`);
    }
  }

  const identityImpl = String(get('IDENTITY_IMPL') ?? 'mock');
  const paymentsImpl = String(get('PAYMENTS_IMPL') ?? 'mock');
  const bookingImpl = String(get('BOOKING_IMPL') ?? 'mock');
  const videoImpl = String(get('VIDEO_IMPL') ?? 'mock');
  const stripeSecretKey = get('STRIPE_SECRET_KEY');
  const stripeWebhookSecret = get('STRIPE_WEBHOOK_SECRET');
  const stripePriceConsult = get('STRIPE_PRICE_CONSULT');
  const stripePriceMembership = get('STRIPE_PRICE_MEMBERSHIP');
  const stripeBillingWebhookSecret = get('STRIPE_BILLING_WEBHOOK_SECRET');
  const calcomApiKey = get('CALCOM_API_KEY');
  const calcomEventTypeId = get('CALCOM_EVENT_TYPE_ID');
  const calcomBookingUrl = get('CALCOM_BOOKING_URL');
  const calcomWebhookSecret = get('CALCOM_WEBHOOK_SECRET');
  const dailyApiKey = get('DAILY_API_KEY');
  const dailyDomain = get('DAILY_DOMAIN');
  const emailImpl = String(get('EMAIL_IMPL') ?? 'mock');
  const resendApiKey = get('RESEND_API_KEY');
  const emailFrom = get('EMAIL_FROM');
  const screeningImpl = String(get('SCREENING_IMPL') ?? 'mock');
  const boolFlag = (v: unknown) => String(v ?? '').toLowerCase() === 'true';
  const purchaseEnabled = boolFlag(get('PURCHASE_ENABLED'));
  const weightLossRx = boolFlag(get('WEIGHTLOSS_RX_ENABLED'));
  const menopauseRx = boolFlag(get('MENOPAUSE_RX_ENABLED'));
  const otcShopEnabled = boolFlag(get('OTC_SHOP_ENABLED'));
  const otcCategories = get('OTC_CATEGORIES');
  const glpConsultRequired = boolFlag(get('GLP_CONSULT_REQUIRED'));
  // Open decision #4: default per_fill (a separate pass-through charge). Only the
  // exact string 'bundled' selects the membership-bundled model.
  const medicationBilling: AppEnv['MEDICATION_BILLING'] =
    String(get('MEDICATION_BILLING') ?? '').toLowerCase() === 'bundled' ? 'bundled' : 'per_fill';
  const waitlistUrl = get('WAITLIST_URL');
  const previewPass = get('PREVIEW_PASS');

  // The Stripe keys are required ONLY when the Stripe identity impl is selected;
  // keeping them out of REQUIRED lets mock dev + tests run without them.
  if (identityImpl === 'stripe') {
    for (const [name, value] of [
      ['STRIPE_SECRET_KEY', stripeSecretKey],
      ['STRIPE_WEBHOOK_SECRET', stripeWebhookSecret],
    ] as const) {
      if (!value) throw new Error(`Missing required env var: ${name} (IDENTITY_IMPL=stripe)`);
    }
  }

  // The Stripe billing keys are required ONLY when the Stripe payments impl is
  // selected. STRIPE_SECRET_KEY is shared with the Identity path; the billing
  // webhook secret + the two price ids are billing-specific.
  if (paymentsImpl === 'stripe') {
    for (const [name, value] of [
      ['STRIPE_SECRET_KEY', stripeSecretKey],
      ['STRIPE_PRICE_CONSULT', stripePriceConsult],
      ['STRIPE_PRICE_MEMBERSHIP', stripePriceMembership],
      ['STRIPE_BILLING_WEBHOOK_SECRET', stripeBillingWebhookSecret],
    ] as const) {
      if (!value) throw new Error(`Missing required env var: ${name} (PAYMENTS_IMPL=stripe)`);
    }
  }

  // Cal.com keys required ONLY when the real booking impl is selected; keeping
  // them out of REQUIRED lets mock dev + tests run without them.
  if (bookingImpl === 'calcom') {
    for (const [name, value] of [
      ['CALCOM_API_KEY', calcomApiKey],
      ['CALCOM_EVENT_TYPE_ID', calcomEventTypeId],
      ['CALCOM_BOOKING_URL', calcomBookingUrl],
      ['CALCOM_WEBHOOK_SECRET', calcomWebhookSecret],
    ] as const) {
      if (!value) throw new Error(`Missing required env var: ${name} (BOOKING_IMPL=calcom)`);
    }
  }

  // Daily keys required ONLY when the real video impl is selected.
  if (videoImpl === 'daily') {
    for (const [name, value] of [
      ['DAILY_API_KEY', dailyApiKey],
      ['DAILY_DOMAIN', dailyDomain],
    ] as const) {
      if (!value) throw new Error(`Missing required env var: ${name} (VIDEO_IMPL=daily)`);
    }
  }

  // The Resend key is required ONLY when EMAIL_IMPL=resend; the mock (default)
  // logs server-side and needs no key, so the no-keys reviewer walk always works.
  if (emailImpl === 'resend') {
    if (!resendApiKey) {
      throw new Error('Missing required env var: RESEND_API_KEY (EMAIL_IMPL=resend)');
    }
  }

  return {
    PUBLIC_SUPABASE_URL: String(get('PUBLIC_SUPABASE_URL')),
    PUBLIC_SUPABASE_ANON_KEY: String(get('PUBLIC_SUPABASE_ANON_KEY')),
    SUPABASE_SERVICE_KEY: String(get('SUPABASE_SERVICE_KEY')),
    CORE_IMPL: String(get('CORE_IMPL') ?? 'mock'),
    DISPENSING_IMPL: String(get('DISPENSING_IMPL') ?? 'mock'),
    IDENTITY_IMPL: identityImpl,
    PAYMENTS_IMPL: paymentsImpl,
    BOOKING_IMPL: bookingImpl,
    VIDEO_IMPL: videoImpl,
    STRIPE_SECRET_KEY: stripeSecretKey != null ? String(stripeSecretKey) : undefined,
    STRIPE_WEBHOOK_SECRET: stripeWebhookSecret != null ? String(stripeWebhookSecret) : undefined,
    STRIPE_PRICE_CONSULT: stripePriceConsult != null ? String(stripePriceConsult) : undefined,
    STRIPE_PRICE_MEMBERSHIP:
      stripePriceMembership != null ? String(stripePriceMembership) : undefined,
    STRIPE_BILLING_WEBHOOK_SECRET:
      stripeBillingWebhookSecret != null ? String(stripeBillingWebhookSecret) : undefined,
    CALCOM_API_KEY: calcomApiKey != null ? String(calcomApiKey) : undefined,
    CALCOM_EVENT_TYPE_ID: calcomEventTypeId != null ? String(calcomEventTypeId) : undefined,
    CALCOM_BOOKING_URL: calcomBookingUrl != null ? String(calcomBookingUrl) : undefined,
    CALCOM_WEBHOOK_SECRET: calcomWebhookSecret != null ? String(calcomWebhookSecret) : undefined,
    DAILY_API_KEY: dailyApiKey != null ? String(dailyApiKey) : undefined,
    DAILY_DOMAIN: dailyDomain != null ? String(dailyDomain) : undefined,
    EMAIL_IMPL: emailImpl,
    RESEND_API_KEY: resendApiKey != null ? String(resendApiKey) : undefined,
    EMAIL_FROM: emailFrom != null ? String(emailFrom) : DEFAULT_EMAIL_FROM,
    SCREENING_IMPL: screeningImpl,
    PURCHASE_ENABLED: purchaseEnabled,
    WEIGHTLOSS_RX_ENABLED: weightLossRx,
    MENOPAUSE_RX_ENABLED: menopauseRx,
    OTC_SHOP_ENABLED: otcShopEnabled,
    OTC_CATEGORIES: otcCategories != null ? String(otcCategories) : '',
    WAITLIST_URL: waitlistUrl != null && String(waitlistUrl) ? String(waitlistUrl) : DEFAULT_WAITLIST_URL,
    GLP_CONSULT_REQUIRED: glpConsultRequired,
    MEDICATION_BILLING: medicationBilling,
    PREVIEW_PASS: previewPass != null && String(previewPass) ? String(previewPass) : undefined,
  };
}
