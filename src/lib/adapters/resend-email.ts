import type { EmailAdapter, EmailMessage, EmailSendResult } from './email';

// ============================================================================
// ResendEmail: the real provider integration, behind the same EmailAdapter
// interface as MockEmail. Calls the Resend REST API directly via fetch — no SDK,
// exactly as the other real adapters (Stripe, Cal.com, Daily). Test mode until
// go-live.
//
// SENDER: the `from` address is a verified Resend sender. For the demo this is a
// SUBDOMAIN of fern.care (noreply@mail.fern.care), verified separately in Resend
// so the app's transactional DNS stays isolated from the live Brevo waitlist mail
// on the fern.care apex (no SPF collision). The from is injected (EMAIL_FROM) so
// the address is a config change, not a code edit.
//
// HARD LINE: a failed send must never block a flow. This adapter throws on a
// provider error (so it is observable), but every CALLER wraps the send in a
// try/catch that swallows + logs — email is a notification side effect, never a
// gate (see src/lib/email/notify.ts).
// ============================================================================
const RESEND_API = 'https://api.resend.com/emails';

export class ResendEmail implements EmailAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {
    if (!apiKey) {
      throw new Error('ResendEmail: RESEND_API_KEY is required when EMAIL_IMPL=resend');
    }
    if (!from) {
      throw new Error('ResendEmail: EMAIL_FROM is required when EMAIL_IMPL=resend');
    }
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const message =
        ((json.message ?? json.error) as string | undefined) ?? `HTTP ${res.status}`;
      throw new Error(`ResendEmail send: ${message}`);
    }
    return { id: String(json.id ?? ''), status: 'sent' };
  }
}
