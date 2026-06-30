// ===========================================================================
// Fern transactional email templates (D5). Each builder returns a composed
// { subject, html, text } — the notify layer adds the recipient. Email-safe HTML:
// table layout, inline styles, hex colours straight from the Fern tokens (no
// external CSS, no webfont dependency — clients that lack Fraunces fall back to a
// serif). British English, no emoji.
//
// HARD LINE: STATUS + NEXT STEP only. No clinical content — no symptoms, no
// medication names, no clinical reasons. "Script" is referred to only as "your
// prescription / treatment" at the category level, the same restraint as the
// patient-facing copy. These templates must never be passed Article 9 data.
// ===========================================================================

// --- Fern palette (from src/styles/tokens/colors.css) -----------------------
const CREAM = '#F8F7F0';
const NAVY = '#1B1C3A';
const NAVY_DEEP = '#14152A';
const CREAM_ON_NAVY = '#FBF8F1';
const PERIWINKLE = '#C6CEF4';
const LIME = '#D6F034';
const BORDER = '#E4DDD0';
const MUTED = '#5A5B72';

const SERIF = "'Fraunces', Georgia, 'Times New Roman', serif";
const SANS = "'Inter', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

export interface ComposedEmail {
  subject: string;
  html: string;
  text: string;
}

// The shared Fern shell: a navy header band carrying the wordmark, a cream body,
// and a quiet navy footer. `body` is the per-template inner HTML.
function shell(opts: { preheader: string; heading: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
</head>
<body style="margin:0;padding:0;background:${CREAM};">
<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;mso-hide:all;">${opts.preheader}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

<!-- header band -->
<tr><td style="background:${NAVY};border-radius:14px 14px 0 0;padding:22px 28px;">
<span style="font-family:${SERIF};font-weight:600;font-size:22px;letter-spacing:-0.01em;color:${CREAM_ON_NAVY};">Fern<span style="color:${LIME};">.</span></span>
</td></tr>

<!-- body card -->
<tr><td style="background:#ffffff;border:1px solid ${BORDER};border-top:none;border-radius:0 0 14px 14px;padding:32px 28px;">
<h1 style="margin:0 0 16px;font-family:${SERIF};font-weight:600;font-size:24px;line-height:1.25;color:${NAVY};">${opts.heading}</h1>
${opts.body}
</td></tr>

<!-- footer -->
<tr><td style="padding:22px 28px;">
<p style="margin:0 0 6px;font-family:${SANS};font-size:12px;line-height:1.5;color:${MUTED};">Fern is a demonstration service. This message was sent for a test account and is not medical advice.</p>
<p style="margin:0;font-family:${SANS};font-size:12px;line-height:1.5;color:${MUTED};">If you did not expect this email you can safely ignore it.</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// A paragraph in the body sans style.
function p(text: string): string {
  return `<p style="margin:0 0 16px;font-family:${SANS};font-size:16px;line-height:1.6;color:${NAVY};">${text}</p>`;
}

// The periwinkle status surface (accent SURFACE, never a button) — carries the
// "where you are / what is next" line.
function statusPanel(label: string, detail: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;">
<tr><td style="background:${PERIWINKLE};border-radius:12px;padding:18px 20px;">
<p style="margin:0 0 4px;font-family:${SANS};font-weight:600;font-size:13px;letter-spacing:0.02em;text-transform:uppercase;color:${NAVY};">${label}</p>
<p style="margin:0;font-family:${SANS};font-size:16px;line-height:1.5;color:${NAVY};">${detail}</p>
</td></tr></table>`;
}

// A navy "next step" button (the only filled-navy action).
function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 8px;">
<tr><td style="background:${NAVY};border-radius:999px;">
<a href="${href}" style="display:inline-block;padding:13px 26px;font-family:${SANS};font-weight:600;font-size:15px;color:${CREAM_ON_NAVY};text-decoration:none;">${label}</a>
</td></tr></table>`;
}

// --- the three transactional emails -----------------------------------------

// Welcome — account created. No clinical content; orients the patient to the
// next onboarding step.
export function welcomeEmail(baseUrl: string): ComposedEmail {
  const subject = 'Welcome to Fern';
  const link = `${baseUrl}/account/profile`;
  const html = shell({
    preheader: 'Your Fern account is ready. Here is what happens next.',
    heading: 'Welcome to Fern',
    body:
      p('Your account is ready. Fern helps you start and continue your care with a clinician, all in one place.') +
      statusPanel('Next step', 'Complete your profile and identity check so a clinician can help you.') +
      button(link, 'Continue setup') +
      p('You can return to your account at any time.'),
  });
  const text = [
    'Welcome to Fern',
    '',
    'Your account is ready. Fern helps you start and continue your care with a clinician, all in one place.',
    '',
    'Next step: complete your profile and identity check so a clinician can help you.',
    `Continue setup: ${link}`,
    '',
    'Fern is a demonstration service. This message is not medical advice.',
  ].join('\n');
  return { subject, html, text };
}

// Consult booked — the patient has booked their assessed consultation. Carries
// the slot time (scheduling, non-clinical) and the link to the consult page. No
// clinical detail.
export function consultBookedEmail(baseUrl: string, slotAt: string | null): ComposedEmail {
  const subject = 'Your consultation is booked';
  const link = `${baseUrl}/consult`;
  const when = formatSlot(slotAt);
  const detail = when
    ? `Your consultation is confirmed for ${when}. Join from your consultation page a few minutes before.`
    : 'Your consultation is confirmed. Join from your consultation page at the scheduled time.';
  const html = shell({
    preheader: 'Your Fern consultation is confirmed.',
    heading: 'Your consultation is booked',
    body:
      p('Your assessed consultation with a Fern clinician is confirmed.') +
      statusPanel(when ? 'Confirmed' : 'Booked', detail) +
      button(link, 'View your consultation') +
      p('You can reschedule from your consultation page if you need to.'),
  });
  const text = [
    'Your consultation is booked',
    '',
    'Your assessed consultation with a Fern clinician is confirmed.',
    '',
    detail,
    `View your consultation: ${link}`,
    '',
    'Fern is a demonstration service. This message is not medical advice.',
  ].join('\n');
  return { subject, html, text };
}

// Script shipped — the clinician-issued prescription has been sent to the
// pharmacy. STATUS only: that treatment is on its way and where to track it. No
// medication name, no clinical reason.
export function scriptShippedEmail(baseUrl: string): ComposedEmail {
  const subject = 'Your treatment is on its way';
  const link = `${baseUrl}/treatment`;
  const html = shell({
    preheader: 'Your prescription has been sent to the pharmacy.',
    heading: 'Your treatment is on its way',
    body:
      p('Good news. A clinician has issued your prescription and it has been sent to the pharmacy.') +
      statusPanel('Sent to the pharmacy', 'You can follow dispensing and delivery from your treatment page.') +
      button(link, 'Track your treatment') +
      p('The pharmacy will update the status as your treatment is dispatched and delivered.'),
  });
  const text = [
    'Your treatment is on its way',
    '',
    'A clinician has issued your prescription and it has been sent to the pharmacy.',
    '',
    'You can follow dispensing and delivery from your treatment page.',
    `Track your treatment: ${link}`,
    '',
    'Fern is a demonstration service. This message is not medical advice.',
  ].join('\n');
  return { subject, html, text };
}

// Format a slot ISO timestamp as a UK-readable date/time. Returns null on a
// missing/unparseable value so the templates fall back to a generic line.
function formatSlot(slotAt: string | null): string | null {
  if (!slotAt) return null;
  const d = new Date(slotAt);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
    timeZoneName: 'short',
  }).format(d);
}
