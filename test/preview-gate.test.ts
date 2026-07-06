import { describe, expect, it } from 'vitest';
import {
  PREVIEW_COOKIE,
  deriveToken,
  readCookie,
  safeEqual,
  buildCookie,
  clearCookie,
} from '../src/lib/preview-gate';

// ===========================================================================
// Phase D — the shared demo password gate. Pure, unit-tested in isolation (like
// cta.ts / start.ts). Proves the token derivation is deterministic (so a cookie
// minted on one *.fern.care origin validates on the other), that the cookie is
// scoped to .fern.care in production but host-only elsewhere (local dev works),
// and that the constant-time compare + cookie reader behave.
//
// This gate is entirely separate from Supabase patient auth (not exercised here).
// ===========================================================================

describe('deriveToken', () => {
  it('is deterministic — the same password always yields the same token', async () => {
    const a = await deriveToken('hunter2');
    const b = await deriveToken('hunter2');
    expect(a).toBe(b);
    // sha256 hex is 64 chars, so a cookie minted by the site validates in the app.
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a different password yields a different token', async () => {
    expect(await deriveToken('hunter2')).not.toBe(await deriveToken('hunter3'));
  });
});

describe('safeEqual', () => {
  it('matches identical strings and rejects any difference (incl. length)', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('readCookie', () => {
  const req = (cookie: string) => new Request('https://x/', { headers: { Cookie: cookie } });

  it('extracts the named cookie among others', () => {
    expect(readCookie(req(`a=1; ${PREVIEW_COOKIE}=tok; b=2`), PREVIEW_COOKIE)).toBe('tok');
  });

  it('returns null when absent or no Cookie header', () => {
    expect(readCookie(req('a=1; b=2'), PREVIEW_COOKIE)).toBeNull();
    expect(readCookie(new Request('https://x/'), PREVIEW_COOKIE)).toBeNull();
  });
});

describe('buildCookie / clearCookie domain scoping', () => {
  it('scopes to .fern.care on a *.fern.care host so both subdomains share it', () => {
    expect(buildCookie('fern.care', 't')).toContain('Domain=.fern.care');
    expect(buildCookie('app.fern.care', 't')).toContain('Domain=.fern.care');
    expect(clearCookie('app.fern.care')).toContain('Domain=.fern.care');
  });

  it('stays host-only on other hosts so local dev + the raw preview URL work', () => {
    expect(buildCookie('localhost', 't')).not.toContain('Domain=');
    expect(buildCookie('fern-app.jimgill.workers.dev', 't')).not.toContain('Domain=');
  });

  it('sets a token cookie and a Max-Age=0 clear cookie', () => {
    expect(buildCookie('fern.care', 'tok')).toContain(`${PREVIEW_COOKIE}=tok`);
    expect(buildCookie('fern.care', 'tok')).toMatch(/Max-Age=\d{3,}/);
    expect(clearCookie('fern.care')).toContain('Max-Age=0');
  });
});
