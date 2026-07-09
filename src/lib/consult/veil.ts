// The demo consult "veil" — a UI-only waiting-state that stands in for the live
// video call during the demo. Behind the DEMO_CONSULT flag (off by default). It
// changes NO journey state and touches NO adapter: with the flag off the real
// Daily consult path is untouched. See src/pages/consult/veil.astro.
//
// The clinician persona name + the consult duration are demo presentation detail
// (there is no clinician tied to a booking_ref, which is a pointer only), so they
// live here as constants rather than in the app DB.

/** The demo clinician the patient "meets" in the veil (presentation only). */
export const DEMO_CLINICIAN_NAME = 'Dr Amara Okafor';

/** The nominal consult length shown in the veil (presentation only). */
export const CONSULT_DURATION_LABEL = '20 minutes';

// Resolve where the consult "Join" button points. When the demo veil is on and a
// join URL exists, the patient is taken to the interstitial; otherwise the real
// (or mock) room join URL is used unchanged. Pure so it is unit-tested in
// isolation and the page stays a thin caller.
export function consultJoinTarget(demoConsult: boolean, joinUrl: string | null): string | null {
  if (demoConsult && joinUrl) return '/consult/veil';
  return joinUrl;
}
