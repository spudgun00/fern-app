import { ACCOUNT_HREF, type CtaFlags } from './cta';
import type { JourneyState } from './journey/states';

// ===========================================================================
// Phase C — the site->app handoff entry point. `/start` is the ONE canonical
// entry the marketing site's Start CTA points at (https://app.fern.care/start).
// A cold visitor arriving from the site with NO session must BEGIN account
// creation here (not land mid-flow); a returning visitor resumes their current
// onboarding step, never a dead end.
//
// This is the pure resolver (unit-tested in isolation, like cta.ts); the /start
// route is a thin wrapper that reads the session + journey and redirects here.
// ===========================================================================

export interface StartContext {
  // Does the caller have an authenticated session?
  hasSession: boolean;
  role?: 'patient' | 'clinician' | null;
  // The patient's current journey state (to resume onboarding), if known.
  state?: JourneyState | null;
}

// Where a visitor hitting /start should be sent.
//   * purchaseEnabled OFF -> the waitlist, mirroring the entry-CTA switch (cta.ts).
//     The site only links here when purchase is on, but /start stays consistent.
//   * No session (a COLD visitor from the marketing site) -> BEGIN account creation
//     (/signup starts the linear onboarding chain: registered -> ID -> intake).
//   * A returning visitor -> resume at their current step; a clinician -> the
//     console; anyone past intake -> their dashboard hub. Never a mid-flow drop.
export function startDestination(
  flags: Pick<CtaFlags, 'purchaseEnabled' | 'waitlistUrl'>,
  ctx: StartContext,
): string {
  if (!flags.purchaseEnabled) return flags.waitlistUrl;
  if (!ctx.hasSession) return ACCOUNT_HREF; // cold visitor: create an account
  return resumeStep(ctx.role, ctx.state);
}

// Where an ALREADY-AUTHENTICATED visitor lands (post log-in, or hitting
// /login|/signup while signed in). Unlike startDestination this has NO purchase
// gate and NO cold-visitor branch: a signed-in user always lands IN the app at
// their current step — never the waitlist, and never the P0 dev harness (which
// is the old plumbing default this replaces). A clinician goes to the console.
export function postLoginDestination(ctx: Pick<StartContext, 'role' | 'state'>): string {
  return resumeStep(ctx.role, ctx.state);
}

// The resume map shared by both resolvers: current journey state -> the step to
// pick up at, never a mid-flow dead end. Anyone past intake goes to their hub.
function resumeStep(role: StartContext['role'], state: StartContext['state']): string {
  if (role === 'clinician') return '/clinician';
  switch (state) {
    case 'registered':
      return '/account/profile';
    case 'id_pending':
      return '/account/verify';
    case 'id_verified':
      return '/intake';
    default:
      // intake_started and everything beyond -> the patient's hub (resume, not restart).
      return '/dashboard';
  }
}
