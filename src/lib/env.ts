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

  return {
    PUBLIC_SUPABASE_URL: String(get('PUBLIC_SUPABASE_URL')),
    PUBLIC_SUPABASE_ANON_KEY: String(get('PUBLIC_SUPABASE_ANON_KEY')),
    SUPABASE_SERVICE_KEY: String(get('SUPABASE_SERVICE_KEY')),
    CORE_IMPL: String(get('CORE_IMPL') ?? 'mock'),
    DISPENSING_IMPL: String(get('DISPENSING_IMPL') ?? 'mock'),
  };
}
