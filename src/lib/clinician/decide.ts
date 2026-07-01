import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClinicalCoreAdapter, RxRequest } from '../adapters/clinical-core';
import {
  advanceJourney,
  getAccountById,
  getJourney,
  getLatestScreeningRef,
  getQueueItemById,
  recordQueueDecision,
  type Account,
  type QueueItem,
} from '../accounts';
import type { JourneyState } from '../journey/states';
import { assertScreeningReadyForDecision } from '../screening/guard';

// ===========================================================================
// P3 — the clinician decision. This is the ONE place a fast-lane intake is
// approved, escalated, or refused. THE HARD LINE LIVES HERE, IN CODE:
//
//   * The actor MUST be a clinician (role check below). A patient-role account
//     cannot reach this path.
//   * The item MUST be a pending fast-lane intake whose journey sits at
//     in_review_queue. Anything else throws.
//   * issuePrescription + the approved -> rx_issued transition happen ONLY in
//     the approve branch, reached ONLY through this clinician-invoked function.
//     No questionnaire-only path calls it. The journey machine independently
//     guarantees rx_issued is reachable ONLY from approved / consult_done.
//   * EVERY decision records clinician + reason + timestamp: the rationale is
//     written to the CORE as a consult note (Article 9 reasoning lives in the
//     core, never the app DB); the app DB records who + when + pointers only.
//
// No code path reaches rx_issued without this clinician action.
// ===========================================================================

export type ClinicianAction = 'approve' | 'escalate' | 'refuse';

export interface DecideInput {
  clinicianAccountId: string;
  queueItemId: string;
  action: ClinicianAction;
  // The clinician's recorded rationale. Required for every decision. Written to
  // the core consult note (clinical reasoning), never stored in the app DB.
  reason: string;
  // Approve only: the script the clinician is issuing. Required for approve.
  rxItems?: RxRequest['items'];
}

export interface DecideResult {
  action: ClinicianAction;
  patientAccountId: string;
  corePatientId: string;
  newState: JourneyState;
  noteId: string;
  rxId: string | null;
}

export class ClinicianDecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClinicianDecisionError';
  }
}

// Defence in depth: the actor must be a clinician. The console routes also gate
// on role, but the hard line is enforced here too so it cannot be bypassed by a
// caller that skips the route guard.
function assertClinician(account: Account | null): asserts account is Account {
  if (!account) throw new ClinicianDecisionError('decide: unknown clinician account');
  if (account.role !== 'clinician') {
    throw new ClinicianDecisionError('decide: only a clinician may decide an intake');
  }
}

export async function decideClinicianAction(
  admin: SupabaseClient,
  core: ClinicalCoreAdapter,
  input: DecideInput,
): Promise<DecideResult> {
  const reason = (input.reason ?? '').trim();
  if (reason === '') {
    // Every decision records clinician + reason + timestamp (hard line).
    throw new ClinicianDecisionError('decide: a decision requires a recorded reason');
  }

  // 1. The actor must be a clinician.
  const clinician = await getAccountById(admin, input.clinicianAccountId);
  assertClinician(clinician);

  // 2. The item must be a pending fast-lane queue item.
  const item: QueueItem | null = await getQueueItemById(admin, input.queueItemId);
  if (!item) throw new ClinicianDecisionError('decide: unknown queue item');
  if (item.lane !== 'fast') {
    throw new ClinicianDecisionError('decide: only fast-lane items are decided here (full lane is P6)');
  }
  if (item.status !== 'pending') {
    throw new ClinicianDecisionError(`decide: queue item already decided (${item.status})`);
  }

  // 3. The patient must have a mapped core record and sit at in_review_queue.
  const patient = await getAccountById(admin, item.account_id);
  if (!patient?.core_patient_id) {
    throw new ClinicianDecisionError('decide: patient has no mapped core record');
  }
  const corePatientId = patient.core_patient_id;
  const journey = await getJourney(admin, patient.id);
  if (journey?.state !== 'in_review_queue') {
    throw new ClinicianDecisionError(
      `decide: patient is not awaiting review (state ${journey?.state ?? 'none'})`,
    );
  }

  // 4. Record the clinician's rationale in the CORE (Article 9 reasoning lives
  //    only behind the adapter). All three actions record a note.
  const noteId = await core.createConsultNote(corePatientId, {
    text: reason,
    clinicianRef: input.clinicianAccountId,
    action: input.action,
  });

  let newState: JourneyState;
  let rxId: string | null = null;

  if (input.action === 'approve') {
    // Screening guard: for a screening-required patient (weight lane), the
    // prescribing decision is blocked until the bloods are in (results_ready).
    // No screening_ref (menopause fast lane) -> no-op. Escalate / refuse below
    // are never gated: a clinician can always route on or decline.
    const screening = await getLatestScreeningRef(admin, patient.id);
    assertScreeningReadyForDecision(screening);
    const items = input.rxItems ?? [];
    if (items.length === 0) {
      throw new ClinicianDecisionError('decide: approve requires at least one prescription item');
    }
    // in_review_queue -> approved (the clinician decision state) ...
    await advanceJourney(admin, patient.id, 'approved');
    // ... then issue the script in the core ...
    rxId = await core.issuePrescription(corePatientId, {
      items,
      clinicianRef: input.clinicianAccountId,
      decisionState: 'approved',
    });
    // ... then approved -> rx_issued. The machine permits rx_issued ONLY from a
    // decision state, so this transition is the proof the script was clinician-issued.
    newState = await advanceJourney(admin, patient.id, 'rx_issued');
    await recordQueueDecision(admin, item.id, {
      status: 'approved',
      decidedBy: input.clinicianAccountId,
      noteRef: noteId,
      rxRef: rxId,
    });
  } else if (input.action === 'escalate') {
    // Re-route the fast-lane patient into the full/assessed lane. The next step
    // (escalated -> consult_booked) is the P6 booking; P3 stops at escalated.
    newState = await advanceJourney(admin, patient.id, 'escalated', 'full');
    await recordQueueDecision(admin, item.id, {
      status: 'escalated',
      decidedBy: input.clinicianAccountId,
      noteRef: noteId,
    });
  } else {
    // refuse: terminal, with a recorded reason (core note) and a patient-facing
    // signpost shown on the patient view.
    newState = await advanceJourney(admin, patient.id, 'refused');
    await recordQueueDecision(admin, item.id, {
      status: 'refused',
      decidedBy: input.clinicianAccountId,
      noteRef: noteId,
    });
  }

  return {
    action: input.action,
    patientAccountId: patient.id,
    corePatientId,
    newState,
    noteId,
    rxId,
  };
}
