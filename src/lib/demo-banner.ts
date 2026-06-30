// The sitewide "demonstration, not yet operating" banner (D1, goal 5).
//
// Injected into every HTML response by the middleware so it appears on EVERY
// route — including surfaces not yet on the design-system Layout (the clinician
// console, intake, treatment, the dev harness) until D2/D3 bring them across.
// This is a cross-cutting safety/honesty affordance: a reviewer or clinical
// lead must never see a screen that looks like a real operating product without
// the demonstration label. Middleware is the right layer for that guarantee.
//
// Styles are inline + literal hex (the corrected periwinkle #C6CEF4 surface,
// navy #1B1C3A text) so the banner renders even on pages that do not load the
// app stylesheet. The Layout does NOT render its own banner — this is the
// single source, so styled pages are not double-bannered.

export const DEMO_BANNER_MARKER = 'data-fern-demo-banner';

const BANNER_HTML =
  `<div ${DEMO_BANNER_MARKER} role="note" style="background:#C6CEF4;border-bottom:1px solid #BFCBF2;font-family:'Inter',system-ui,-apple-system,sans-serif;">` +
  `<div style="max-width:1080px;margin:0 auto;padding:8px 28px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">` +
  `<span aria-hidden="true" style="width:8px;height:8px;border-radius:999px;background:#1B1C3A;flex:none;"></span>` +
  `<p style="margin:0;font-size:13.5px;line-height:1.4;color:#1B1C3A;">` +
  `<strong style="font-weight:600;">Demonstration, not yet operating.</strong> ` +
  `Dummy data, no real patients or live care.</p>` +
  `<a href="/about-this-demo" style="margin-left:auto;font-size:11.5px;letter-spacing:0.06em;text-transform:uppercase;color:#1B1C3A;text-decoration:none;border-bottom:1px solid #1B1C3A;padding-bottom:1px;white-space:nowrap;">About this demo</a>` +
  `</div></div>`;

const BODY_OPEN = /<body[^>]*>/i;

// Returns a new Response with the banner injected at the top of <body>, or the
// original response untouched when it is not an injectable HTML page.
export async function injectDemoBanner(response: Response): Promise<Response> {
  const contentType = response.headers.get('content-type') || '';
  if (response.status !== 200 || !contentType.includes('text/html')) return response;

  const html = await response.text();
  // Already injected, or no <body> to inject into: leave it be.
  if (html.includes(DEMO_BANNER_MARKER) || !BODY_OPEN.test(html)) {
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers: stripContentLength(response.headers),
    });
  }

  const injected = html.replace(BODY_OPEN, (match) => `${match}${BANNER_HTML}`);
  return new Response(injected, {
    status: response.status,
    statusText: response.statusText,
    headers: stripContentLength(response.headers),
  });
}

// Preserve all headers (including Set-Cookie) but drop a stale content-length —
// the body length changed, and a wrong content-length truncates the response.
function stripContentLength(source: Headers): Headers {
  const headers = new Headers(source);
  headers.delete('content-length');
  return headers;
}
