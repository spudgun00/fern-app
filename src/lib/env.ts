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
}

const DEFAULT_EMAIL_FROM = 'Fern <noreply@mail.fern.care>';

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
  };
}
