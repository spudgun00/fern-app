import { defineMiddleware } from 'astro:middleware';
import { env as cfEnv } from 'cloudflare:workers';
import { readEnv } from './lib/env';
import { createSupabaseServerClient } from './lib/supabase/server';
import { injectDemoBanner } from './lib/demo-banner';

// Populates locals for every request: the resolved env, an anon-key cookie
// session client, and the current authenticated user (or null).
//
// On the Workers runtime, bindings (vars + secrets) come from the
// `cloudflare:workers` env import (Astro v6+ removed Astro.locals.runtime.env).
export const onRequest = defineMiddleware(async (context, next) => {
  const env = readEnv(cfEnv as unknown as Record<string, unknown>);
  context.locals.env = env;

  const supabase = createSupabaseServerClient(context, env);
  context.locals.supabase = supabase;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  context.locals.user = user;

  // Sitewide demo banner: inject into every HTML response so it appears on every
  // route, including surfaces not yet on the design-system Layout (D2/D3).
  const response = await next();
  return injectDemoBanner(response);
});
