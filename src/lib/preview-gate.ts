// Phase D — the shared demo password gate across *.fern.care.
//
// ONE password (env PREVIEW_PASS) unlocks BOTH fern.care (the marketing site,
// Cloudflare Pages) and app.fern.care (this app, a Worker). A small password
// page sets a cookie on Domain=.fern.care; because the cookie is scoped to the
// registrable-parent domain, entering the password once on either subdomain
// unlocks the other with no second challenge. The cookie holds a DERIVED token
// (sha256 of a fixed salt + the password), never the password itself.
//
// This is the OUTER demo gate ONLY. It is entirely separate from — and does not
// touch — Supabase patient auth (src/lib/supabase/*, src/middleware.ts's session
// client). The gate wraps the whole preview; Supabase still owns who the patient
// is once inside.
//
// The identical derivation (same SALT, same cookie name, same algorithm) is
// mirrored in the marketing repo's functions/_middleware.js so a token minted on
// one origin validates on the other.

export const PREVIEW_COOKIE = 'fern_preview';

// Bump this to force every existing cookie to re-authenticate.
const SALT = 'fern-preview-gate-v1';

// The cookie token: sha256 hex of `${SALT}:${password}`. Deterministic, so both
// origins compute the same expected value from the same PREVIEW_PASS. Web Crypto
// is available on the Workers + Pages Functions runtimes and in Node 18+ (tests).
export async function deriveToken(pass: string): Promise<string> {
  const data = new TextEncoder().encode(`${SALT}:${pass}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Read a single cookie value from a request's Cookie header (no dependency on the
// framework's cookie parser, so this works identically on both runtimes).
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

// Constant-time-ish compare (mirrors the site middleware): XOR every byte and OR
// the differences so a mismatch never short-circuits and leaks a timing signal.
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

// On a *.fern.care host, scope the cookie to the parent domain so both subdomains
// share it. On any other host (localhost, *.workers.dev) stay host-only so local
// dev + the raw preview URL still work.
function domainAttr(host: string): string {
  return host === 'fern.care' || host.endsWith('.fern.care') ? '; Domain=.fern.care' : '';
}

// The Set-Cookie value that grants access. 30 days; the gate is a soft demo lock.
export function buildCookie(host: string, token: string): string {
  return `${PREVIEW_COOKIE}=${token}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax${domainAttr(host)}`;
}

// A Set-Cookie value that clears the gate cookie (for a logout affordance).
export function clearCookie(host: string): string {
  return `${PREVIEW_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax${domainAttr(host)}`;
}
