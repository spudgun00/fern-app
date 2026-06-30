import type { BookingAdapter, BookingResult, BookingSession } from './booking';

// CalcomBooking: the real provider integration, behind the same BookingAdapter
// interface as MockBooking. Calls the Cal.com REST API directly via fetch — we
// deliberately do NOT pull in any Node SDK, exactly as StripeIdentity /
// StripePayments do. Test mode until go-live.
//
// HARD LINE: this adapter returns only the hosted booking-page URL, our own
// correlation pointer, a coarse status, and the chosen slot time. The booking
// record + attendee details stay with Cal.com; the app persists provider pointer
// + status + slot only.
//
// Flow (mirrors the Stripe Checkout hosted-page pattern): we mint a correlation
// ref, embed it in the hosted booking page's metadata, and send the user there.
// On booking, Cal.com fires the BOOKING_CREATED webhook carrying that metadata
// (the authoritative path, /api/webhooks/calcom-booking). getBookingStatus is the
// idempotent return-page fallback: it scans recent bookings for our ref.
const CALCOM_API = 'https://api.cal.com/v2';
const CALCOM_API_VERSION = '2024-08-13';

export class CalcomBooking implements BookingAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly eventTypeId: string,
    private readonly bookingUrl: string,
  ) {
    if (!apiKey) {
      throw new Error('CalcomBooking: CALCOM_API_KEY is required when BOOKING_IMPL=calcom');
    }
    if (!eventTypeId || !bookingUrl) {
      throw new Error(
        'CalcomBooking: CALCOM_EVENT_TYPE_ID and CALCOM_BOOKING_URL are required when BOOKING_IMPL=calcom',
      );
    }
  }

  private async call(path: string, method: 'GET' | 'POST') {
    const res = await fetch(`${CALCOM_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'cal-api-version': CALCOM_API_VERSION,
        'Content-Type': 'application/json',
      },
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const message =
        (json.error as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`;
      throw new Error(`CalcomBooking ${method} ${path}: ${message}`);
    }
    return json;
  }

  async createBooking(accountId: string, returnUrl: string): Promise<BookingSession> {
    // Our correlation pointer. The hosted page carries it as metadata so the
    // webhook + the status poll can map a confirmed booking back to this account
    // with no PII stored app-side.
    const fernRef = `fern_${crypto.randomUUID()}`;
    const params = new URLSearchParams({
      'metadata[fernRef]': fernRef,
      'metadata[accountId]': accountId,
      redirectUrl: returnUrl,
    });
    return { bookingId: fernRef, clientUrl: `${this.bookingUrl}?${params.toString()}` };
  }

  async getBookingStatus(bookingId: string): Promise<BookingResult> {
    // Scan recent bookings for our correlation ref. The webhook is authoritative;
    // this poll is the idempotent fallback when the user lands back on the return
    // page before the webhook is processed.
    const json = await this.call(
      `/bookings?eventTypeId=${encodeURIComponent(this.eventTypeId)}&sortStart=desc&take=50`,
      'GET',
    );
    const bookings = (json.data as Array<Record<string, unknown>> | undefined) ?? [];
    const match = bookings.find(
      (b) => ((b.metadata as Record<string, string> | undefined)?.fernRef ?? '') === bookingId,
    );
    if (!match) return { status: 'pending' };

    const status = String(match.status ?? '');
    if (status === 'cancelled' || status === 'rejected') return { status: 'canceled' };
    if (status === 'accepted') {
      return { status: 'booked', slotAt: match.start != null ? String(match.start) : undefined };
    }
    return { status: 'pending' };
  }
}
