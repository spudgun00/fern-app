import { afterAll, describe, expect, it } from 'vitest';
import { readEnv } from '../src/lib/env';
import { createAdminClient } from '../src/lib/supabase/admin';
import { MockCore } from '../src/lib/adapters/mock-core';
import { MockDispensing } from '../src/lib/adapters/mock-dispensing';
import { MockBooking } from '../src/lib/adapters/mock-booking';
import { MockVideo } from '../src/lib/adapters/mock-video';
import { submitIntake } from '../src/lib/intake/submit';
import {
  finaliseLatestBooking,
  startConsultBooking,
  BookingError,
} from '../src/lib/consult/booking';
import { decideConsultAction } from '../src/lib/clinician/consult';
import { dispenseIssuedScript } from '../src/lib/dispensing/dispense';
import type { IntakeAnswers } from '../src/lib/intake/routing';
import {
  ALLOWED_TRANSITIONS,
  RX_ISSUED_PREDECESSORS,
  canTransition,
} from '../src/lib/journey/machine';
import { JOURNEY_STATES } from '../src/lib/journey/states';
import {
  ensureAccount,
  getJourney,
  getLatestBookingRef,
  listPendingConsults,
  recordPaymentRef,
  setCorePatientId,
  setJourney,
  type BookingRef,
} from '../src/lib/accounts';

// A first-time initiation set with otherwise clean answers -> the FULL lane.
function fullLaneAnswers(): IntakeAnswers {
  return {
    treatmentHistory: 'initiation',
    symptoms: ['hot_flushes'],
    monthsSinceLastPeriod: 14,
    bpSystolic: 122,
    bpDiastolic: 76,
    clotHistory: false,
    breastCancerHistory: false,
    liverDisease: false,
    unexplainedBleeding: false,
    currentPregnancy: false,
    suspectedClotSymptoms: false,
    undiagnosedBreastLump: false,
  };
}

const env = {
  ...readEnv(),
  CORE_IMPL: 'mock',
  DISPENSING_IMPL: 'mock',
  BOOKING_IMPL: 'mock',
  VIDEO_IMPL: 'mock',
};
const admin = createAdminClient(env);
const core = new MockCore(admin);
const dispensing = new MockDispensing(admin);
const booking = new MockBooking(admin);
const video = new MockVideo();
const createdAccounts: string[] = [];

async function freshClinician(): Promise<string> {
  const account = await ensureAccount(admin, crypto.randomUUID());
  createdAccounts.push(account.id);
  const { error } = await admin.from('account').update({ role: 'clinician' }).eq('id', account.id);
  if (error) throw new Error(error.message);
  return account.id;
}

async function freshFullLanePatient(): Promise<{ accountId: string; corePatientId: string }> {
  const account = await ensureAccount(admin, crypto.randomUUID());
  createdAccounts.push(account.id);
  const corePatientId = await core.createPatient({ fullName: 'P6 Test Patient' });
  await setCorePatientId(admin, account.id, corePatientId);
  await setJourney(admin, account.id, 'id_verified', null);
  // Routes to the full lane: intake_submitted, lane full, no queue_item.
  await submitIntake(admin, core, account.id, corePatientId, 'menopause', fullLaneAnswers());
  return { accountId: account.id, corePatientId };
}

// Mark the consult fee paid directly (P5 records the pointer; here we only need
// the gate satisfied — no card data, just a paid pointer).
async function payConsult(accountId: string): Promise<void> {
  await recordPaymentRef(admin, accountId, 'consult', `sess_${crypto.randomUUID()}`, 'paid');
}

// Walk a fresh full-lane patient to consult_booked: pay, book (mock), mark the
// slot, finalise. Returns the booking ref (booked).
async function patientAtConsultBooked(): Promise<{
  accountId: string;
  corePatientId: string;
  bookingRef: BookingRef;
}> {
  const { accountId, corePatientId } = await freshFullLanePatient();
  await payConsult(accountId);

  const clientUrl = await startConsultBooking(admin, booking, accountId, '/consult/book/complete');
  const bookingId = new URL(clientUrl, 'https://x').searchParams.get('booking')!;
  await booking.markBooked(bookingId, new Date('2026-07-15T09:00:00.000Z').toISOString());
  await finaliseLatestBooking(admin, booking, video, accountId);

  const bookingRef = (await getLatestBookingRef(admin, accountId))!;
  return { accountId, corePatientId, bookingRef };
}

afterAll(async () => {
  if (createdAccounts.length === 0) return;
  await admin.from('mock_booking_session').delete().in('account_id', createdAccounts);
  // Account delete cascades journey / booking_ref / intake_ref / payment_ref.
  await admin.from('account').delete().in('id', createdAccounts);
});

// ===========================================================================
// Adapter round-trips (host-agnostic via the same interface).
// ===========================================================================
describe('P6 adapters: booking + video round-trip', () => {
  it('MockBooking: createBooking -> markBooked -> getBookingStatus is consistent', async () => {
    const account = await ensureAccount(admin, crypto.randomUUID());
    createdAccounts.push(account.id);
    const session = await booking.createBooking(account.id, '/r');
    expect(session.bookingId).toBeTruthy();
    expect(session.clientUrl).toContain('/consult/book/mock');

    expect((await booking.getBookingStatus(session.bookingId)).status).toBe('pending');
    const slot = new Date('2026-07-20T11:00:00.000Z').toISOString();
    await booking.markBooked(session.bookingId, slot);
    const result = await booking.getBookingStatus(session.bookingId);
    expect(result.status).toBe('booked');
    // Postgres round-trips the timestamptz with a +00:00 offset rather than the
    // literal ...000Z; compare the instant, not the string.
    expect(new Date(result.slotAt!).getTime()).toBe(new Date(slot).getTime());
  });

  it('MockVideo: createRoom -> getRoom resolves the same join URL (stateless)', async () => {
    const room = await video.createRoom('consult-abc');
    expect(room.roomRef).toContain('consult-abc');
    expect(room.joinUrl).toContain('/consult/room/mock');
    const again = await video.getRoom(room.roomRef);
    expect(again?.joinUrl).toBe(room.joinUrl);
  });
});

// ===========================================================================
// Success test (part 1): booking is gated on the consult fee, then creates the
// room and advances intake_submitted -> consult_booked.
// ===========================================================================
describe('full-lane booking: gated on the consult fee, then -> consult_booked', () => {
  it('a patient who has NOT paid the consult fee cannot book', async () => {
    const { accountId } = await freshFullLanePatient();
    await expect(
      startConsultBooking(admin, booking, accountId, '/r'),
    ).rejects.toThrow(BookingError);
    // The journey did not move; still awaiting booking.
    expect((await getJourney(admin, accountId))?.state).toBe('intake_submitted');
  });

  it('paying then booking advances to consult_booked with a slot + a video room', async () => {
    const { accountId, bookingRef } = await patientAtConsultBooked();

    const journey = await getJourney(admin, accountId);
    expect(journey?.state).toBe('consult_booked');
    expect(journey?.lane).toBe('full');

    expect(bookingRef.status).toBe('booked');
    expect(bookingRef.slot_at).toBeTruthy();
    expect(bookingRef.room_ref).toBeTruthy();

    // The room ref resolves to a join URL via the video adapter.
    const room = await video.getRoom(bookingRef.room_ref!);
    expect(room?.joinUrl).toBeTruthy();
  });

  it('finalisation is idempotent: a second poll does not double-advance', async () => {
    const { accountId } = await patientAtConsultBooked();
    // The webhook + the return page can both fire; the second is a no-op.
    const again = await finaliseLatestBooking(admin, booking, video, accountId);
    expect(again).toBeNull(); // nothing pending: the pointer already flipped to booked
    expect((await getJourney(admin, accountId))?.state).toBe('consult_booked');
  });
});

// ===========================================================================
// Success test (part 2): the clinician closes the full lane at the consult.
// ===========================================================================
describe('decideConsultAction: the clinician closes the full lane', () => {
  it('ISSUE: issues a (mock) script from consult_done and advances to rx_issued', async () => {
    const clinicianId = await freshClinician();
    const { accountId, corePatientId, bookingRef } = await patientAtConsultBooked();

    const result = await decideConsultAction(admin, core, {
      clinicianAccountId: clinicianId,
      bookingRefId: bookingRef.id,
      action: 'issue',
      reason: 'Assessed initiation consult complete; suitable for transdermal HRT.',
      rxItems: [{ name: 'Transdermal HRT', dose: 'as directed', quantity: 1 }],
    });

    expect(result.newState).toBe('rx_issued');
    expect(result.rxId).toBeTruthy();
    expect((await getJourney(admin, accountId))?.state).toBe('rx_issued');

    // The script lives in the CORE and is clinician-issued from the consult_done
    // decision state (the full-lane entry to rx_issued).
    const scripts = await core.getPrescriptions(corePatientId);
    expect(scripts).toHaveLength(1);
    expect(scripts[0].request.decisionState).toBe('consult_done');
    expect(scripts[0].request.clinicianRef).toBe(clinicianId);

    // App DB: the booking_ref carries the consult-decision audit pointers only.
    const decided = await getLatestBookingRef(admin, accountId);
    expect(decided?.status).toBe('issued');
    expect(decided?.decided_by).toBe(clinicianId);
    expect(decided?.decided_at).toBeTruthy();
    expect(decided?.note_ref).toBeTruthy();
    expect(decided?.rx_ref).toBe(result.rxId);

    // The route composes dispensing after the issue (rx_issued -> dispensing).
    await dispenseIssuedScript(admin, core, dispensing, {
      accountId,
      corePatientId,
      rxId: result.rxId!,
    });
    expect((await getJourney(admin, accountId))?.state).toBe('dispensing');
  });

  it('REFUSE: terminates at refused with a recorded reason, issues NO script', async () => {
    const clinicianId = await freshClinician();
    const { accountId, corePatientId, bookingRef } = await patientAtConsultBooked();

    const result = await decideConsultAction(admin, core, {
      clinicianAccountId: clinicianId,
      bookingRefId: bookingRef.id,
      action: 'refuse',
      reason: 'Not suitable for HRT initiation here; signpost to GP.',
    });

    expect(result.newState).toBe('refused');
    expect(result.rxId).toBeNull();
    expect((await getJourney(admin, accountId))?.state).toBe('refused');
    expect(await core.getPrescriptions(corePatientId)).toHaveLength(0);

    const decided = await getLatestBookingRef(admin, accountId);
    expect(decided?.status).toBe('refused');
    expect(decided?.rx_ref).toBeNull();
    expect(decided?.note_ref).toBeTruthy();
  });

  it('the decided consult no longer appears in the pending consult queue', async () => {
    const clinicianId = await freshClinician();
    const { bookingRef } = await patientAtConsultBooked();
    expect((await listPendingConsults(admin)).some((c) => c.id === bookingRef.id)).toBe(true);

    await decideConsultAction(admin, core, {
      clinicianAccountId: clinicianId,
      bookingRefId: bookingRef.id,
      action: 'refuse',
      reason: 'signpost',
    });
    expect((await listPendingConsults(admin)).some((c) => c.id === bookingRef.id)).toBe(false);
  });
});

// ===========================================================================
// HARD LINE made executable: rx_issued is reachable ONLY via a clinician action,
// and every decision records a clinician + reason.
// ===========================================================================
describe('P6 hard line: the consult decision is the only full-lane entry to rx_issued', () => {
  it('a NON-clinician actor cannot decide a consult', async () => {
    const { accountId, bookingRef } = await patientAtConsultBooked();
    await expect(
      decideConsultAction(admin, core, {
        clinicianAccountId: accountId, // the patient's own (patient-role) account
        bookingRefId: bookingRef.id,
        action: 'issue',
        reason: 'self-issue attempt',
        rxItems: [{ name: 'x' }],
      }),
    ).rejects.toThrow(/only a clinician/i);
    expect((await getJourney(admin, accountId))?.state).toBe('consult_booked');
  });

  it('a decision REQUIRES a recorded reason', async () => {
    const clinicianId = await freshClinician();
    const { bookingRef } = await patientAtConsultBooked();
    await expect(
      decideConsultAction(admin, core, {
        clinicianAccountId: clinicianId,
        bookingRefId: bookingRef.id,
        action: 'issue',
        reason: '   ',
        rxItems: [{ name: 'x' }],
      }),
    ).rejects.toThrow(/reason/i);
  });

  it('ISSUE requires at least one prescription item (no empty script)', async () => {
    const clinicianId = await freshClinician();
    const { bookingRef } = await patientAtConsultBooked();
    await expect(
      decideConsultAction(admin, core, {
        clinicianAccountId: clinicianId,
        bookingRefId: bookingRef.id,
        action: 'issue',
        reason: 'issue',
        rxItems: [],
      }),
    ).rejects.toThrow(/at least one/i);
  });

  it('a consult that is not booked (no booking) cannot be decided', async () => {
    const clinicianId = await freshClinician();
    // A full-lane patient who paid but never booked has no booked booking_ref.
    const { accountId } = await freshFullLanePatient();
    await payConsult(accountId);
    const clientUrl = await startConsultBooking(admin, booking, accountId, '/r');
    const bookingId = new URL(clientUrl, 'https://x').searchParams.get('booking')!;
    // pointer exists but is still 'pending' (never marked booked / finalised).
    const ref = (await getLatestBookingRef(admin, accountId))!;
    expect(ref.status).toBe('pending');
    void bookingId;
    await expect(
      decideConsultAction(admin, core, {
        clinicianAccountId: clinicianId,
        bookingRefId: ref.id,
        action: 'issue',
        reason: 'too early',
        rxItems: [{ name: 'x' }],
      }),
    ).rejects.toThrow(/not awaiting a decision/i);
  });

  it('an already-decided consult cannot be decided again', async () => {
    const clinicianId = await freshClinician();
    const { bookingRef } = await patientAtConsultBooked();
    await decideConsultAction(admin, core, {
      clinicianAccountId: clinicianId,
      bookingRefId: bookingRef.id,
      action: 'refuse',
      reason: 'first decision',
    });
    await expect(
      decideConsultAction(admin, core, {
        clinicianAccountId: clinicianId,
        bookingRefId: bookingRef.id,
        action: 'issue',
        reason: 'second decision',
        rxItems: [{ name: 'x' }],
      }),
    ).rejects.toThrow(/already been decided|not awaiting a decision/i);
  });
});

// ===========================================================================
// Machine: P6 adds consult_done -> refused WITHOUT widening the rx_issued guard.
// ===========================================================================
describe('P6 machine: refuse-after-consult is legal; rx_issued guard untouched', () => {
  it('consult_done -> refused is now a legal transition', () => {
    expect(canTransition('consult_done', 'refused')).toBe(true);
  });

  it('the only predecessors of rx_issued remain approved and consult_done', () => {
    const predecessors = JOURNEY_STATES.filter((from) =>
      ALLOWED_TRANSITIONS[from].includes('rx_issued'),
    ).sort();
    expect(predecessors).toEqual(['approved', 'consult_done']);
    expect([...RX_ISSUED_PREDECESSORS].sort()).toEqual(['approved', 'consult_done']);
  });
});

// ===========================================================================
// HARD LINE made executable: booking_ref holds NO clinical content / PII —
// only pointers + scheduling/decision status. Mirrors the P4/P5 denylists.
// ===========================================================================
describe('P6 hard line: booking_ref holds no clinical content / card data / PII', () => {
  const DENYLIST = /card|cvc|cvv|pan|number|name|address|email|phone|dob|amount|price|answer|symptom|diagnos|reason|note_text/i;

  it('booking_ref has exactly the pointer + scheduling/decision columns', async () => {
    const { accountId } = await patientAtConsultBooked();
    const { data, error } = await admin
      .from('booking_ref')
      .select('*')
      .eq('account_id', accountId)
      .single();
    expect(error).toBeFalsy();

    const cols = Object.keys(data!).sort();
    expect(cols).toEqual(
      [
        'account_id',
        'created_at',
        'decided_at',
        'decided_by',
        'id',
        'note_ref',
        'provider_ref',
        'room_ref',
        'rx_ref',
        'slot_at',
        'status',
      ].sort(),
    );
    for (const col of cols) {
      expect(col, `booking_ref.${col} looks like clinical content / PII`).not.toMatch(DENYLIST);
    }
  });
});
