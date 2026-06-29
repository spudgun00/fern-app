import {
  createServerClient,
  parseCookieHeader,
  type CookieOptions,
} from '@supabase/ssr';
import type { AstroCookies } from 'astro';
import type { AppEnv } from '../env';

interface RequestContext {
  request: Request;
  cookies: AstroCookies;
}

// Cookie-based session client using the ANON key. Used for auth + session only
// (it respects RLS). Privileged data access uses the admin client instead.
export function createSupabaseServerClient(ctx: RequestContext, env: AppEnv) {
  return createServerClient(env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return parseCookieHeader(ctx.request.headers.get('Cookie') ?? '').map(
          ({ name, value }) => ({ name, value: value ?? '' }),
        );
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          ctx.cookies.set(name, value, options as CookieOptions);
        });
      },
    },
  });
}
