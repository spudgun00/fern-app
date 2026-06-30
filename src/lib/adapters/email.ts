// ===========================================================================
// EmailAdapter — the transactional-email seam (D5). Same shape as the other
// adapters: one interface, a Mock + a real (Resend) impl behind getEmail() /
// EMAIL_IMPL. The app only ever talks to this interface, so swapping providers
// (or running keyless on the mock) is a flag change with zero call-site edits.
//
// HARD LINE: email is a NON-CLINICAL notification side effect. No journey
// transition depends on a send; a failed send never blocks a flow (the callers
// swallow + log). An email body carries STATUS + NEXT STEP only — category-level,
// the same restraint as the patient-facing copy. No Article 9 / clinical content
// ever reaches an email (no symptoms, no medication names, no clinical reasons).
// ===========================================================================

// A fully-composed message, ready to send. Templates (see src/lib/email/
// templates.ts) produce this; the adapter only transmits it.
export interface EmailMessage {
  to: string;
  subject: string;
  // Both parts are always provided: html for clients that render it, text as the
  // plain-text fallback. Neither carries clinical detail.
  html: string;
  text: string;
}

export interface EmailSendResult {
  // A provider message id when available (Resend returns one); the mock returns a
  // synthetic id. Never required by a caller — email never gates.
  id: string;
  // 'sent' for a successful transmit, 'logged' for the mock no-keys walk.
  status: 'sent' | 'logged';
}

export interface EmailAdapter {
  send(message: EmailMessage): Promise<EmailSendResult>;
}
