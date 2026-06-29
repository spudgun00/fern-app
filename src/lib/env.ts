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
}

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
  const stripeSecretKey = get('STRIPE_SECRET_KEY');
  const stripeWebhookSecret = get('STRIPE_WEBHOOK_SECRET');
  const stripePriceConsult = get('STRIPE_PRICE_CONSULT');
  const stripePriceMembership = get('STRIPE_PRICE_MEMBERSHIP');
  const stripeBillingWebhookSecret = get('STRIPE_BILLING_WEBHOOK_SECRET');

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

  return {
    PUBLIC_SUPABASE_URL: String(get('PUBLIC_SUPABASE_URL')),
    PUBLIC_SUPABASE_ANON_KEY: String(get('PUBLIC_SUPABASE_ANON_KEY')),
    SUPABASE_SERVICE_KEY: String(get('SUPABASE_SERVICE_KEY')),
    CORE_IMPL: String(get('CORE_IMPL') ?? 'mock'),
    DISPENSING_IMPL: String(get('DISPENSING_IMPL') ?? 'mock'),
    IDENTITY_IMPL: identityImpl,
    PAYMENTS_IMPL: paymentsImpl,
    STRIPE_SECRET_KEY: stripeSecretKey != null ? String(stripeSecretKey) : undefined,
    STRIPE_WEBHOOK_SECRET: stripeWebhookSecret != null ? String(stripeWebhookSecret) : undefined,
    STRIPE_PRICE_CONSULT: stripePriceConsult != null ? String(stripePriceConsult) : undefined,
    STRIPE_PRICE_MEMBERSHIP:
      stripePriceMembership != null ? String(stripePriceMembership) : undefined,
    STRIPE_BILLING_WEBHOOK_SECRET:
      stripeBillingWebhookSecret != null ? String(stripeBillingWebhookSecret) : undefined,
  };
}
