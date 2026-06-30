// The booking (Cal.com) boundary. ALL consult-scheduling operations go through
// this one interface, so the rest of the app stays provider-agnostic (Cal.com
// now, another scheduler later) exactly as the clinical core, dispensing,
// identity, and payments boundaries do. Never branch on the impl outside the
// factory.
//
// HARD LINE (P6): the booking record lives with the provider (Cal.com), NEVER in
// the app DB. This interface deliberately surfaces only a session/booking pointer
// (bookingId), a redirect URL, a coarse status, and the chosen slot time (a
// non-clinical scheduling fact). No method returns attendee PII. The app DB
// stores the provider pointer + status + slot only.

export interface BookingSession {
  // Opaque provider booking/session id. Persisted app-side as a pointer only.
  bookingId: string;
  // Where to send the user to pick a slot (provider-hosted for Cal.com, an in-app
  // mock page for MockBooking).
  clientUrl: string;
}

export type BookingStatus =
  | 'pending' // created, awaiting the user picking a slot
  | 'booked' // a slot is confirmed
  | 'canceled'; // abandoned or cancelled

export interface BookingResult {
  status: BookingStatus;
  // The confirmed appointment time (ISO string), present once status is 'booked'.
  slotAt?: string;
}

export interface BookingAdapter {
  createBooking(accountId: string, returnUrl: string): Promise<BookingSession>;
  getBookingStatus(bookingId: string): Promise<BookingResult>;
}
