import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClinicalCoreAdapter, RxRequest } from '../adapters/clinical-core';
import {
  advanceJourney,
  getAccountById,
  getBookingRefById,
  getJourney,
  getLatestScreeningRef,
  recordConsultDecision,
  type Account,
  type BookingRef,
} from '../accounts';
import type { JourneyState } from '../journey/states';
import { assertScreeningReadyForDecision } from '../screening/guard';
import type { PaymentsAdapter } from '../adapters/payments';
import { refundOnRefusal } from '../weight/refund';

// ===========================================================================
// P6 — the full-lane clinician decision. This is the ONE place a booked consult
// is closed: the clinician joins the video room with the intake on screen, writes
// the note to the core, then ISSUES the script or REFUSES + signposts. It is the
// full-lane parallel to decideClinicianAction (P3, the fast lane) and enforces
// THE SAME HARD LINE, IN CODE:
//
//   * The actor MUST be a clinician (role check below). A patient cannot reach it.
//   * The patient MUST be in the full lane at a booked consult — journey at
//     consult_booked or consult_done. Anything else throws.
//   * issuePrescription + the consult_done -> rx_issued transition happen ONLY in
//     the issue branch, reached ONLY through this clinician-invoked function. The
//     journey machine independently guarantees rx_issued is reachable ONLY from
//     approved (P3) / consult_done (here): RX_ISSUED_PREDECESSORS is unchanged.
//   * EVERY decision records clinician + reason + timestamp: the rationale is a
//     CORE consult note (Article 9 reasoning lives in the core); the app DB
//     records who + when + pointers only, on the booking_ref.
//
// On "escalate": the full/assessed lane IS the escalation target of the fast lane,
// so there is nowhere further to escalate to. The action bar is therefore Issue |
// Refuse; the hard line ("a clinician can always refuse or escalate") is honoured
// by Refuse being always available. No code path reaches rx_issued without this
// clinician action.
// ===========================================================================

export type ConsultAction = 'issue' | 'refuse';

export interface ConsultDecideInput {
  clinicianAccountId: string;
  bookingRefId: string;
  action: ConsultAction;
  // The clinician's recorded rationale. Required for every decision. Written to
  // the core consult note (clinical reasoning), never stored in the app DB.
  reason: string;
  // Issue only: the script the clinician is issuing. Required for issue.
  rxItems?: RxRequest['items'];
}

export interface ConsultDecideResult {
  action: ConsultAction;
  patientAccountId: string;
  corePatientId: string;
  newState: JourneyState;
  noteId: string;
  rxId: string | null;
  // True when a pay-first treatment charge was automatically refunded on refuse
  // (weight roadmap P4). False for every non-refunded decision.
  refunded: boolean;
}

export class ConsultDecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConsultDecisionError';
  }
}

// Defence in depth: the actor must be a clinician. The console route also gates on
// role, but the hard line is enforced here too so it cannot be bypassed.
function assertClinician(account: Account | null): asserts account is Account {
  if (!account) throw new ConsultDecisionError('consult: unknown clinician account');
  if (account.role !== 'clinician') {
    throw new ConsultDecisionError('consult: only a clinician may decide a consult');
  }
}

export async function decideConsultAction(
  admin: SupabaseClient,
  core: ClinicalCoreAdapter,
  input: ConsultDecideInput,
  // Optional (weight roadmap P4). When supplied, a REFUSE automatically refunds a
  // pay-first treatment charge (refund-on-refusal). Omitted by callers/tests that
  // do not touch the pay-first lane.
  payments?: PaymentsAdapter,
): Promise<ConsultDecideResult> {
  const reason = (input.reason ?? '').trim();
  if (reason === '') {
    // Every decision records clinician + reason + timestamp (hard line).
    throw new ConsultDecisionError('consult: a decision requires a recorded reason');
  }

  // 1. The actor must be a clinician.
  const clinician = await getAccountById(admin, input.clinicianAccountId);
  assertClinician(clinician);

  // 2. The booking must exist, be booked, and not already decided.
  const ref: BookingRef | null = await getBookingRefById(admin, input.bookingRefId);
  if (!ref) throw new ConsultDecisionError('consult: unknown booking');
  if (ref.status !== 'booked') {
    throw new ConsultDecisionError(`consult: booking is not awaiting a decision (${ref.status})`);
  }
  if (ref.decided_at) {
    throw new ConsultDecisionError('consult: this consult has already been decided');
  }

  // 3. The patient must have a mapped core record and sit at the consult.
  const patient = await getAccountById(admin, ref.account_id);
  if (!patient?.core_patient_id) {
    throw new ConsultDecisionError('consult: patient has no mapped core record');
  }
  const corePatientId = patient.core_patient_id;
  const journey = await getJourney(admin, patient.id);
  if (journey?.state !== 'consult_booked' && journey?.state !== 'consult_done') {
    throw new ConsultDecisionError(
      `consult: patient is not at a booked consult (state ${journey?.state ?? 'none'})`,
    );
  }

  // Screening guard: for a screening-required patient (weight lane), the ISSUE
  // (prescribing) decision is blocked until the bloods are in (results_ready).
  // Checked BEFORE any state change so a blocked issue moves nothing. No
  // screening_ref -> no-op. Refuse is never gated (a clinician can always decline).
  if (input.action === 'issue') {
    const screening = await getLatestScreeningRef(admin, patient.id);
    assertScreeningReadyForDecision(screening);
  }

  // The consult has taken place: advance consult_booked -> consult_done (the
  // decision is taken at consult_done). Idempotent if already there.
  if (journey.state === 'consult_booked') {
    await advanceJourney(admin, patient.id, 'consult_done');
  }

  // 4. Record the clinician's rationale in the CORE (Article 9 reasoning lives
  //    only behind the adapter). Both actions record a note.
  const noteId = await core.createConsultNote(corePatientId, {
    text: reason,
    clinicianRef: input.clinicianAccountId,
    action: input.action,
    consult: true,
  });

  let newState: JourneyState;
  let rxId: string | null = null;
  let refunded = false;

  if (input.action === 'issue') {
    const items = input.rxItems ?? [];
    if (items.length === 0) {
      throw new ConsultDecisionError('consult: issuing a script requires at least one item');
    }
    // Issue the script in the core (decisionState consult_done) ...
    rxId = await core.issuePrescription(corePatientId, {
      items,
      clinicianRef: input.clinicianAccountId,
      decisionState: 'consult_done',
    });
    // ... then consult_done -> rx_issued. The machine permits rx_issued ONLY from
    // a decision state, so this transition is the proof the script was
    // clinician-issued after the consult.
    newState = await advanceJourney(admin, patient.id, 'rx_issued');
    await recordConsultDecision(admin, ref.id, {
      status: 'issued',
      decidedBy: input.clinicianAccountId,
      noteRef: noteId,
      rxRef: rxId,
    });
  } else {
    // refuse: terminal, with a recorded reason (core note) and a patient-facing
    // signpost. consult_done -> refused (added to the machine in P6; the
    // rx_issued guard is untouched).
    newState = await advanceJourney(admin, patient.id, 'refused');
    await recordConsultDecision(admin, ref.id, {
      status: 'refused',
      decidedBy: input.clinicianAccountId,
      noteRef: noteId,
    });
    // Refund-on-refusal (weight P4): a pay-first treatment charge is returned
    // automatically here. No-op when the patient never paid; only runs when a
    // payments adapter is passed.
    if (payments) {
      refunded = await refundOnRefusal(admin, payments, patient.id);
    }
  }

  return {
    action: input.action,
    patientAccountId: patient.id,
    corePatientId,
    newState,
    noteId,
    rxId,
    refunded,
  };
}
