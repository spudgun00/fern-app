// The identity-verification boundary. ALL ID-verification operations go through
// this one interface, so the rest of the app stays provider-agnostic (Stripe
// Identity now, Persona or another later) exactly as the clinical core and
// dispensing boundaries do. Never branch on the impl outside the factory.
//
// HARD LINE (P1): document images and extracted ID PII live with the provider,
// NEVER in the app DB. This interface deliberately surfaces only a session
// pointer (sessionId), a redirect URL, and a coarse status. No method returns
// document data, a selfie, a name, or a date of birth. The app DB stores the
// provider_ref + status only.

export interface VerificationSession {
  // Opaque provider session id. This is the only identifier persisted app-side
  // (as id_verification.provider_ref). It is a pointer, not PII.
  sessionId: string;
  // Where to send the user to complete the check (provider-hosted for Stripe,
  // an in-app mock page for MockIdentity).
  clientUrl: string;
}

export type VerificationStatus =
  | 'requires_input' // created, awaiting the user / more input
  | 'processing' // submitted, provider still deciding
  | 'verified' // passed
  | 'canceled'; // abandoned or failed

export interface IdentityAdapter {
  createVerificationSession(accountId: string, returnUrl: string): Promise<VerificationSession>;
  getVerificationStatus(sessionId: string): Promise<VerificationStatus>;
}
