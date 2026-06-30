import type { SupabaseClient } from '@supabase/supabase-js';
import type { BookingAdapter } from '../adapters/booking';
import type { VideoAdapter } from '../adapters/video';
import {
  advanceJourney,
  getJourney,
  getLatestBookingRef,
  getLatestPendingBookingRef,
  hasPaidConsult,
  recordBookingRef,
  setBookingRefBooked,
  type BookingRef,
} from '../accounts';
import type { JourneyState } from '../journey/states';

// ===========================================================================
// P6 — the full (assessed) lane: booking. A patient routed (or escalated) to the
// full lane pays the consult fee (P5 gate), books a slot (Cal.com, mocked behind
// the BookingAdapter), and a video room (Daily, mocked behind the VideoAdapter)
// is created for the consult. The clinician then decides at consult_done (see
// src/lib/clinician/consult.ts) — the SAME hard line as P3.
//
// BOUNDARY (hard line): the booking record lives with the provider, the call with
// the video provider, never the app DB. The app DB holds booking_ref, a POINTER +
// scheduling/decision status only. Booking does NOT prescribe; it only schedules.
//
// GATE (P5 tiering): the full-lane booking is gated on hasPaidConsult — the first
// script follows a paid, assessed consult. A patient who has not paid the consult
// fee cannot book.
// ===========================================================================

// The journey states from which a full-lane consult may be booked: a patient
// routed straight to the full lane sits at intake_submitted (lane full); an
// escalated fast-lane patient sits at escalated. Both legally reach consult_booked.
const BOOKABLE_FROM: readonly JourneyState[] = ['intake_submitted', 'escalated'];

export class BookingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookingError';
  }
}

// Start a booking: enforce the consult-fee gate + the bookable state, create the
// provider booking session, record a pending booking_ref pointer (so the return
// page can finalise the in-flight booking), and return the hosted/mock booking URL.
export async function startConsultBooking(
  admin: SupabaseClient,
  booking: BookingAdapter,
  accountId: string,
  returnUrl: string,
): Promise<string> {
  // P5 gate: the assessed first script follows a paid consult.
  if (!(await hasPaidConsult(admin, accountId))) {
    throw new BookingError(
      'A consultation fee must be paid before booking the assessed consult.',
    );
  }

  const journey = await getJourney(admin, accountId);
  if (!journey || !BOOKABLE_FROM.includes(journey.state)) {
    throw new BookingError(
      `Not ready to book a consult (state ${journey?.state ?? 'none'}). The assessed lane books from intake_submitted or escalated.`,
    );
  }

  const session = await booking.createBooking(accountId, returnUrl);
  await recordBookingRef(admin, accountId, session.bookingId, 'pending');
  return session.clientUrl;
}

export interface BookingFinalisation {
  status: BookingRef['status'];
  booked: boolean;
}

// The return-page entry point: finalise whatever booking is in flight for this
// account (the latest pending booking_ref). Idempotent with the webhook and safe
// to call on every load of the return page. Returns null if nothing is pending.
export async function finaliseLatestBooking(
  admin: SupabaseClient,
  booking: BookingAdapter,
  video: VideoAdapter,
  accountId: string,
): Promise<BookingFinalisation | null> {
  const pending = await getLatestPendingBookingRef(admin, accountId);
  if (!pending?.provider_ref) return null;
  return finaliseBooking(admin, booking, video, accountId, pending);
}

// Finalise one booking (idempotent with the webhook). Reads the live provider
// status and, when booked: creates the video room (keyed by the booking_ref id,
// so it is reproducible + idempotent), flips the pointer to booked with the slot
// + room, then advances the journey -> consult_booked (only from a bookable
// state, so a re-fire does not double-advance).
export async function finaliseBooking(
  admin: SupabaseClient,
  booking: BookingAdapter,
  video: VideoAdapter,
  accountId: string,
  ref: BookingRef,
): Promise<BookingFinalisation> {
  const result = await booking.getBookingStatus(ref.provider_ref ?? '');
  if (result.status !== 'booked') {
    return { status: result.status, booked: false };
  }

  // Create (or reuse) the consult video room. The room ref is the only thing
  // persisted app-side; the call lives with the provider.
  const room = await video.createRoom(ref.id);
  await setBookingRefBooked(admin, ref.id, result.slotAt ?? null, room.roomRef);

  // Advance the journey only from a bookable state (idempotent: a second poll /
  // the webhook finds the patient already at consult_booked and skips).
  const journey = await getJourney(admin, accountId);
  if (journey && BOOKABLE_FROM.includes(journey.state)) {
    await advanceJourney(admin, accountId, 'consult_booked', 'full');
  }

  return { status: 'booked', booked: true };
}

export interface ConsultView {
  state: JourneyState | null;
  consultPaid: boolean;
  booking: BookingRef | null;
  slotAt: string | null;
  // The video room join URL, resolved from the booking's room_ref. Both the
  // patient room page and the clinician console join the same URL.
  joinUrl: string | null;
  // Whether the patient is eligible to start a booking now (full lane, paid, not
  // yet booked).
  canBook: boolean;
}

// The patient consult view: where the patient is in the full lane, the booked
// slot, and the room join URL. Reads pointers from the app DB and resolves the
// join URL from the video provider.
export async function getConsultView(
  admin: SupabaseClient,
  booking: BookingAdapter,
  video: VideoAdapter,
  accountId: string,
): Promise<ConsultView> {
  const journey = await getJourney(admin, accountId);
  const consultPaid = await hasPaidConsult(admin, accountId);
  const ref = await getLatestBookingRef(admin, accountId);

  let joinUrl: string | null = null;
  if (ref?.room_ref) {
    const room = await video.getRoom(ref.room_ref);
    joinUrl = room?.joinUrl ?? null;
  }

  const state = journey?.state ?? null;
  const inFullLane = journey?.lane === 'full';
  const canBook =
    consultPaid &&
    inFullLane &&
    !!state &&
    BOOKABLE_FROM.includes(state) &&
    (!ref || ref.status !== 'pending');

  return {
    state,
    consultPaid,
    booking: ref,
    slotAt: ref?.slot_at ?? null,
    joinUrl,
    canBook,
  };
}
