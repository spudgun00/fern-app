import type { EmailAdapter, EmailMessage, EmailSendResult } from './email';

// ============================================================================
// MockEmail: the THROWAWAY no-keys stand-in for the real email provider. It does
// not send anything — it LOGS the fully-composed message server-side so the
// zero-keys reviewer walk stays whole and the composed email is inspectable in
// the Worker logs. Deleted/ignored once EMAIL_IMPL=resend in a real environment.
//
// It also keeps an in-process record of what it "sent" (the `sent` array) so the
// adapter round-trip test can assert the composed message without a network call.
// ============================================================================
export class MockEmail implements EmailAdapter {
  // In-process log of composed messages, in send order. Test-facing only.
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<EmailSendResult> {
    this.sent.push(message);
    // Log the composed email (no clinical content by construction) so the no-keys
    // walk shows what would have gone out. Subject + recipient only at info level;
    // the body is available on the record for a deeper look.
    console.log(`[MockEmail] to=${message.to} subject=${JSON.stringify(message.subject)}`);
    const id = `mockmail-${this.sent.length}`;
    return { id, status: 'logged' };
  }
}
