import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { injectDemoBanner, DEMO_BANNER_MARKER } from '../src/lib/demo-banner';

// Strip CSS comments: the header documents the correction and legitimately
// names the stale value it replaced, so we assert against the DECLARATIONS only.
const colorsCss = readFileSync(
  fileURLToPath(new URL('../src/styles/tokens/colors.css', import.meta.url)),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

// D1 hard line: the vendored tokens are a COPY of the CORRECTED system, not a
// verbatim copy of the stale marketing file. The page-ground cream was
// corrected from the too-warm #F4EFE5 to #F8F7F0; this test locks that so a
// future re-sync cannot silently re-introduce the bug.
describe('D1 design tokens — corrected cream is locked', () => {
  it('uses the corrected cream #F8F7F0', () => {
    expect(colorsCss).toContain('#F8F7F0');
  });

  it('does not re-introduce the stale warm cream #F4EFE5 (any case)', () => {
    expect(colorsCss.toUpperCase()).not.toContain('#F4EFE5');
  });

  it('does not re-introduce the stale cream in rgba form', () => {
    expect(colorsCss).not.toContain('244,239,229');
  });
});

// The sitewide demo banner is injected by the middleware into HTML responses
// only, exactly once, without corrupting the response.
describe('D1 demo banner injection', () => {
  const htmlResponse = (body: string, init: ResponseInit = {}) =>
    new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      ...init,
    });

  it('injects the banner at the top of <body> on an HTML 200', async () => {
    const res = await injectDemoBanner(htmlResponse('<html><body><h1>Hi</h1></body></html>'));
    const text = await res.text();
    expect(text).toContain(DEMO_BANNER_MARKER);
    // injected immediately after the opening body tag, before page content
    expect(text.indexOf(DEMO_BANNER_MARKER)).toBeLessThan(text.indexOf('<h1>'));
  });

  it('does not inject into a JSON response', async () => {
    const res = await injectDemoBanner(
      new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const text = await res.text();
    expect(text).not.toContain(DEMO_BANNER_MARKER);
  });

  it('does not inject into a non-200 (e.g. redirect/error) response', async () => {
    const res = await injectDemoBanner(
      new Response('', { status: 302, headers: { 'content-type': 'text/html', location: '/login' } }),
    );
    const text = await res.text();
    expect(text).not.toContain(DEMO_BANNER_MARKER);
    expect(res.headers.get('location')).toBe('/login');
  });

  it('does not double-inject when the marker is already present', async () => {
    const once = await injectDemoBanner(htmlResponse('<html><body><h1>Hi</h1></body></html>'));
    const twice = await injectDemoBanner(once);
    const text = await twice.text();
    const occurrences = text.split(DEMO_BANNER_MARKER).length - 1;
    expect(occurrences).toBe(1);
  });

  it('drops a stale content-length so the response is not truncated', async () => {
    const res = await injectDemoBanner(
      htmlResponse('<html><body><h1>Hi</h1></body></html>', { headers: { 'content-type': 'text/html', 'content-length': '36' } }),
    );
    expect(res.headers.get('content-length')).toBeNull();
  });

  it('preserves Set-Cookie headers through injection', async () => {
    const res = await injectDemoBanner(
      htmlResponse('<html><body>x</body></html>', { headers: { 'content-type': 'text/html', 'set-cookie': 'sb=abc; Path=/' } }),
    );
    expect(res.headers.get('set-cookie')).toContain('sb=abc');
  });
});
