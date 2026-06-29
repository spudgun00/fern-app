import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClinicalCoreAdapter, Rx } from '../adapters/clinical-core';
import type { DispensingAdapter, DeliveryTracking, DispenseStatus } from '../adapters/dispensing';
import { MockDispensing } from '../adapters/mock-dispensing';
import {
  advanceJourney,
  getJourney,
  getLatestDispenseRef,
  getLatestIntakeRef,
  insertFastQueueItem,
  isActiveMember,
  recordDispenseRef,
  setDispenseRefStatus,
  type DispenseRef,
} from '../accounts';

// ===========================================================================
// P4 — dispensing. The clinician-issued script flows to the pharmacy (CloudRx,
// mocked behind the DispensingAdapter) and the patient sees status + tracking.
//
// BOUNDARY (hard line): the script + the pharmacy dispensing record live ONLY
// behind the DispensingAdapter / core. The app DB holds dispense_ref, a POINTER
// + coarse status only (rx_ref, dispense_id, submitted|dispatched|delivered).
//
// This is the ONE place an issued script is transmitted to dispensing. It is
// deliberately separate from the clinician decision (decideClinicianAction stops
// at rx_issued, the clinical decision): dispensing is downstream transmission,
// not a prescribing decision, and the same function serves both lanes (P3 fast
// approve here; P6 full-lane consult later) once a script exists at rx_issued.
// ===========================================================================

export interface DispenseResult {
  rxId: string;
  dispenseId: string;
  status: string;
}

// Transmit an already-issued script (the patient sits at rx_issued) to the
// dispensing provider, record the app-DB pointer, and advance rx_issued ->
// dispensing. The journey machine independently bars this from any state other
// than rx_issued, so a script cannot reach dispensing without first being
// clinician-issued.
export async function dispenseIssuedScript(
  admin: SupabaseClient,
  core: ClinicalCoreAdapter,
  dispensing: DispensingAdapter,
  input: { accountId: string; corePatientId: string; rxId: string },
): Promise<DispenseResult> {
  // Look up the issued script in the core so the pharmacy record is complete.
  // The items stay behind the dispensing adapter (the CloudRx boundary), never
  // in the app DB.
  const scripts = await core.getPrescriptions(input.corePatientId);
  const script = scripts.find((s) => s.id === input.rxId);
  if (!script) {
    throw new Error(`dispenseIssuedScript: no issued script ${input.rxId} for patient`);
  }

  const dispenseId = await dispensing.submitPrescription({
    rxId: input.rxId,
    corePatientId: input.corePatientId,
    items: script.request.items,
  });

  // App DB: pointer + coarse status only.
  await recordDispenseRef(admin, input.accountId, input.rxId, dispenseId, 'submitted');

  // rx_issued -> dispensing. Throws IllegalTransitionError if the patient is not
  // at rx_issued (defence in depth beyond the route ordering).
  await advanceJourney(admin, input.accountId, 'dispensing');

  return { rxId: input.rxId, dispenseId, status: 'submitted' };
}

export interface TreatmentView {
  script: Rx | null;
  dispense: DispenseRef | null;
  status: DispenseStatus | null;
  tracking: DeliveryTracking | null;
  // Whether this patient holds an active membership (drives the no-charge repeat
  // tiering, P5).
  isMember: boolean;
  // True only when a script has been dispensed AND the patient is an active
  // member: a member's repeat is membership-covered and goes through the queue
  // with no new consult charge (P5 tiering). A dispensed non-member is prompted
  // to subscribe instead.
  canRequestRepeat: boolean;
}

// The patient "your treatment" view: their current script (their own clinical
// record, read server-side for display, never copied app-side), the dispensing
// status, and the delivery tracking. Reads the script from the core and the
// status/tracking from the dispensing provider via the app-DB dispense_ref
// pointer.
export async function getTreatmentView(
  admin: SupabaseClient,
  core: ClinicalCoreAdapter,
  dispensing: DispensingAdapter,
  accountId: string,
  corePatientId: string,
): Promise<TreatmentView> {
  const scripts = await core.getPrescriptions(corePatientId);
  const dispense = await getLatestDispenseRef(admin, accountId);

  // Match the latest dispense to its script when possible; else show the latest.
  const script =
    (dispense && scripts.find((s) => s.id === dispense.rx_ref)) ??
    scripts[scripts.length - 1] ??
    null;

  let status: DispenseStatus | null = null;
  let tracking: DeliveryTracking | null = null;
  if (dispense) {
    status = await dispensing.getDispenseStatus(dispense.dispense_id);
    tracking = await dispensing.getDeliveryTracking(dispense.dispense_id);
  }

  const isMember = await isActiveMember(admin, accountId);
  return {
    script,
    dispense,
    status,
    tracking,
    isMember,
    canRequestRepeat: Boolean(dispense) && isMember,
  };
}

// Lodge a repeat request: a member asks to repeat their last script. It writes a
// repeat request to the core and enters the clinician review queue (a fresh
// pending fast-lane queue_item pointing at the prior intake, so the console reads
// the same clinical picture).
//
// P5 TIERING (the no-charge repeat): a repeat is membership-covered, so an ACTIVE
// member lodges it with NO new consult charge. A non-member cannot ride free; the
// route directs them to subscribe / pay first. The hard line still holds: a repeat
// issues NO script on its own (the clinician still decides) — lodging only enters
// the queue, it never charges and never prescribes.
export async function lodgeRepeatRequest(
  admin: SupabaseClient,
  core: ClinicalCoreAdapter,
  accountId: string,
  corePatientId: string,
): Promise<{ requestId: string; queueItemId: string }> {
  if (!(await isActiveMember(admin, accountId))) {
    throw new Error(
      'lodgeRepeatRequest: a no-charge repeat requires an active membership. Subscribe to continue.',
    );
  }

  const scripts = await core.getPrescriptions(corePatientId);
  const last = scripts[scripts.length - 1];
  if (!last) {
    throw new Error('lodgeRepeatRequest: no prior script to repeat');
  }

  const requestId = await core.createRepeatRequest(corePatientId, last.id);

  // The review reads a clinical picture via queue_item.intake_id; point it at the
  // patient's latest intake (the record the repeat is judged against).
  const ref = await getLatestIntakeRef(admin, accountId);
  if (!ref) {
    throw new Error('lodgeRepeatRequest: no prior intake for the repeat to reference');
  }
  const queueItemId = await insertFastQueueItem(admin, accountId, ref.intake_id);

  return { requestId, queueItemId };
}

// DEV-ONLY affordance (mock dispensing only): step the patient's latest dispense
// through submitted -> dispatched -> delivered, so the status view is walkable on
// the deployed URL. The real CloudRx pushes these transitions itself. When the
// mock reaches delivered, the journey advances dispensing -> delivered.
export async function advanceDispensing(
  admin: SupabaseClient,
  dispensing: DispensingAdapter,
  accountId: string,
  now: string,
): Promise<string | null> {
  if (!(dispensing instanceof MockDispensing)) {
    // Not the mock: status advances come from the provider, not a dev button.
    return null;
  }
  const dispense = await getLatestDispenseRef(admin, accountId);
  if (!dispense) return null;

  const next = await dispensing.advanceStatus(dispense.dispense_id, now);
  await setDispenseRefStatus(admin, dispense.dispense_id, next);

  // The terminal mock status completes the journey: dispensing -> delivered.
  if (next === 'delivered') {
    const journey = await getJourney(admin, accountId);
    if (journey?.state === 'dispensing') {
      await advanceJourney(admin, accountId, 'delivered');
    }
  }
  return next;
}
