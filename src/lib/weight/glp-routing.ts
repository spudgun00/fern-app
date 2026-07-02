// ===========================================================================
// Checkout C3 — the GLP initiation routing switch.
//
// Open compliance question (see the patient-zone handover + the checkout spec
// s10.3): can GLP-1 treatment be INITIATED async on a clinician's sign-off of the
// at-home bloods, or must initiation include a 1:1 video consult? The answer is a
// compliance-pass decision, so the code carries BOTH paths behind one flag and
// flips WITHOUT a rewrite:
//
//   * async  (GLP_CONSULT_REQUIRED=false, the default base tier): a screened weight
//     patient routes to the async clinician review queue (results_ready ->
//     in_review_queue), the existing path. A clinician signs off the bloods.
//   * consult (GLP_CONSULT_REQUIRED=true): the same screened patient routes to the
//     assessed lane instead — they pay the consult fee (Journey C) and book a
//     consult (results_ready -> consult_booked). A clinician decides at the consult.
//
// THE HARD LINE is untouched either way: a clinician makes the prescribing decision
// in both routes; rx_issued stays reachable only from approved / consult_done. The
// switch only chooses WHICH clinician-decision lane a screened GLP patient enters.
// ===========================================================================

export type GlpInitiationRoute = 'async' | 'consult';

export interface GlpRoutingFlags {
  // GLP_CONSULT_REQUIRED — true forces the consult lane for GLP initiation.
  consultRequired: boolean;
}

// Pure: pick the GLP initiation route from the flag. Default (consultRequired
// false) is the async base tier. Unit-tested in isolation.
export function glpInitiationRoute(flags: GlpRoutingFlags): GlpInitiationRoute {
  return flags.consultRequired ? 'consult' : 'async';
}

export function glpRoutingFromEnv(env: { GLP_CONSULT_REQUIRED: boolean }): GlpRoutingFlags {
  return { consultRequired: env.GLP_CONSULT_REQUIRED };
}
