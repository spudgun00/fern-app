import { defineMiddleware } from 'astro:middleware';
import { env as cfEnv } from 'cloudflare:workers';
import { readEnv } from './lib/env';
import { createSupabaseServerClient } from './lib/supabase/server';
import { injectDemoBanner } from './lib/demo-banner';
import { PREVIEW_COOKIE, deriveToken, readCookie, safeEqual } from './lib/preview-gate';

// Phase D — the outer demo password gate. Runs BEFORE Supabase patient auth
// (which is untouched below). Active only when PREVIEW_PASS is configured; the
// gate page and the external webhooks are always exempt (a webhook cannot carry
// the cookie). Unset PREVIEW_PASS => the gate is disabled (local dev + tests).
async function previewGateRedirect(
  context: Parameters<Parameters<typeof defineMiddleware>[0]>[0],
  previewPass: string | undefined,
): Promise<Response | null> {
  if (!previewPass) return null;
  const url = new URL(context.request.url);
  const path = url.pathname;
  if (path === '/gate' || path.startsWith('/api/webhooks/')) return null;

  const token = readCookie(context.request, PREVIEW_COOKIE);
  const expected = await deriveToken(previewPass);
  if (token && safeEqual(token, expected)) return null;

  const next = encodeURIComponent(path + url.search);
  return context.redirect(`/gate?next=${next}`, 302);
}

// Populates locals for every request: the resolved env, an anon-key cookie
// session client, and the current authenticated user (or null).
//
// On the Workers runtime, bindings (vars + secrets) come from the
// `cloudflare:workers` env import (Astro v6+ removed Astro.locals.runtime.env).
export const onRequest = defineMiddleware(async (context, next) => {
  const env = readEnv(cfEnv as unknown as Record<string, unknown>);
  context.locals.env = env;

  // Outer demo gate first: if the visitor has not entered the shared preview
  // password, bounce to /gate before doing any Supabase / journey work.
  const gated = await previewGateRedirect(context, env.PREVIEW_PASS);
  if (gated) return gated;

  // The raw developer harness (/dev/*, /api/dev/*) is unreachable unless
  // DEV_TOOLS_ENABLED is on: in the demo/preview it 404s so no reviewer can land
  // on it. The reviewer-facing demo panel (/demo, /api/demo/*) is NOT gated here.
  if (!env.DEV_TOOLS_ENABLED) {
    const p = new URL(context.request.url).pathname;
    if (p === '/dev' || p.startsWith('/dev/') || p.startsWith('/api/dev/')) {
      return new Response('Not found', { status: 404 });
    }
  }

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
