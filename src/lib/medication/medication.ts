import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClinicalCoreAdapter } from '../adapters/clinical-core';
import type { DispensingAdapter } from '../adapters/dispensing';
import type { PaymentsAdapter } from '../adapters/payments';
import type { AppEnv } from '../env';
import type { CtaFlags, FrontDoor } from '../cta';
import { getJourney, getLatestPaymentRef, isActiveMember, setPaymentRefStatus } from '../accounts';
import { dispenseIssuedScript, type DispenseNotify } from '../dispensing/dispense';

// ===========================================================================
// Checkout C5 — Journey F (medication). The POM the clinician has ALREADY
// prescribed is dispensed via CloudRx as a PASS-THROUGH charge (at cost, optional
// prescriber margin). This module is the GATE that turns a completed medication
// payment into dispensing.
//
// THE HARD LINE, load-bearing here: paying for medication NEVER creates or reaches
// rx_issued. rx_issued is a PRECONDITION of this gate, not a result — the script
// already exists from the clinician action (decideClinicianAction / decideConsult
// Action). This module only advances rx_issued -> dispensing (via the shared
// dispenseIssuedScript, which the journey machine bars from any state other than
// rx_issued). RX_ISSUED_PREDECESSORS stays {approved, consult_done}, untouched.
//
// OPEN DECISION #4 (per-fill vs bundled), kept as config, never hard-coded:
//   * 'per_fill' (default) — a separate pass-through charge; dispensing waits for
//     the medication payment to be paid.
//   * 'bundled'            — no separate charge; an ACTIVE member's dispensing
//     proceeds (the medication cost rides the membership).
// ===========================================================================

export type MedicationBilling = AppEnv['MEDICATION_BILLING'];

export function medicationBillingFromEnv(env: Pick<AppEnv, 'MEDICATION_BILLING'>): MedicationBilling {
  return env.MEDICATION_BILLING;
}

// Does dispensing WAIT for a separate medication payment? Only inside the purchase
// funnel AND when medication is billed per-fill. When the funnel is off (pre-CQC
// default) or medication is bundled, dispensing is NOT deferred to a Journey-F
// charge — the clinician-decision route dispenses inline exactly as before, so no
// existing flow changes while the purchase funnel is off.
export function dispensingAwaitsMedicationPayment(
  flags: Pick<CtaFlags, 'purchaseEnabled'>,
  billing: MedicationBilling,
): boolean {
  return flags.purchaseEnabled && billing === 'per_fill';
}

// The medication product id for a patient's front door. menopause -> the C6-gated
// menopause medication; weight -> the weightLossRx-gated weight medication. The
// caller resolves it through getProduct so the relevant flag still gates it.
export function medicationProductIdForDoor(door: FrontDoor): string {
  return door === 'weight' ? 'weight_medication' : 'menopause_medication';
}

export interface MedicationGateResult {
  // True when the medication is covered — paid (per_fill) or member (bundled).
  covered: boolean;
  // True when THIS call advanced rx_issued -> dispensing.
  advancedToDispensing: boolean;
  // The journey state after the gate ran.
  state: string | null;
  // The dispensing-provider pointer, when a dispense was created.
  dispenseId?: string;
}

// THE GATE. When the patient sits at rx_issued (a clinician-issued script exists)
// AND the medication is covered, dispense the pre-existing script (rx_issued ->
// dispensing). Idempotent: once past rx_issued this is a no-op (the state guard),
// and it never advances toward rx_issued. Coverage:
//   * per_fill — a paid 'medication' payment_ref.
//   * bundled  — an active membership (no separate charge).
export async function advanceOnMedicationPaid(
  admin: SupabaseClient,
  core: ClinicalCoreAdapter,
  dispensing: DispensingAdapter,
  accountId: string,
  corePatientId: string,
  billing: MedicationBilling,
  notify?: DispenseNotify,
): Promise<MedicationGateResult> {
  const journey = await getJourney(admin, accountId);

  // rx_issued is the ONLY state from which paying-for-medication dispenses. The
  // script pre-exists (clinician action); this gate never creates rx_issued. Any
  // other state (not yet issued, or already dispensing) -> no-op.
  if (journey?.state !== 'rx_issued') {
    return { covered: false, advancedToDispensing: false, state: journey?.state ?? null };
  }

  const covered =
    billing === 'bundled'
      ? await isActiveMember(admin, accountId)
      : (await getLatestPaymentRef(admin, accountId, 'medication'))?.status === 'paid';

  if (!covered) {
    return { covered: false, advancedToDispensing: false, state: 'rx_issued' };
  }

  // Dispense the clinician-issued script (the latest one). dispenseIssuedScript
  // performs rx_issued -> dispensing; the machine bars it from any other state.
  const scripts = await core.getPrescriptions(corePatientId);
  const script = scripts[scripts.length - 1];
  if (!script) {
    return { covered: true, advancedToDispensing: false, state: 'rx_issued' };
  }

  const result = await dispenseIssuedScript(
    admin,
    core,
    dispensing,
    { accountId, corePatientId, rxId: script.id },
    notify,
  );
  const after = await getJourney(admin, accountId);
  return {
    covered: true,
    advancedToDispensing: true,
    state: after?.state ?? null,
    dispenseId: result.dispenseId,
  };
}

// The return-page entry point (per-fill): finalise the in-flight medication
// checkout (mark the pending session paid by reading the live provider status),
// then run the gate. Idempotent with the webhook; safe to call on every load.
export async function finaliseMedicationCheckout(
  admin: SupabaseClient,
  payments: PaymentsAdapter,
  core: ClinicalCoreAdapter,
  dispensing: DispensingAdapter,
  accountId: string,
  corePatientId: string,
  billing: MedicationBilling,
  notify?: DispenseNotify,
): Promise<MedicationGateResult> {
  const ref = await getLatestPaymentRef(admin, accountId, 'medication');
  if (ref?.provider_ref && ref.status !== 'paid' && ref.status !== 'refunded') {
    const result = await payments.getCheckoutStatus(ref.provider_ref);
    if (result.status === 'complete') {
      await setPaymentRefStatus(admin, ref.provider_ref, 'paid');
    }
  }
  return advanceOnMedicationPaid(admin, core, dispensing, accountId, corePatientId, billing, notify);
}
