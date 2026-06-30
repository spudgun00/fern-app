import type { SupabaseClient } from '@supabase/supabase-js';
import type { BookingAdapter, BookingResult, BookingSession } from './booking';

// ============================================================================
// MockBooking: a THROWAWAY DEV STAND-IN for the real booking provider (Cal.com),
// NOT the production integration. It models the PROVIDER's own side of a booking,
// so its session store (mock_booking_session) is the provider's record, not
// app-DB state. Like Cal.com it holds the booking and its status + chosen slot;
// it holds NO attendee PII (the mock has none). Deleted when the real Cal.com
// adapter is wired behind the same BookingAdapter interface.
//
// Completion: a real provider confirms a booking after the user picks a slot. The
// mock booking page (/consult/book/mock) and its confirm route drive that via
// markBooked(), a MOCK-ONLY affordance NOT part of the BookingAdapter interface
// (the real Cal.com path is completed by the user in test mode, proven on the
// deployed URL).
// ============================================================================
export class MockBooking implements BookingAdapter {
  constructor(private readonly db: SupabaseClient) {}

  private fail(op: string, message: string): never {
    throw new Error(`MockBooking.${op}: ${message}`);
  }

  async createBooking(accountId: string, returnUrl: string): Promise<BookingSession> {
    const id = crypto.randomUUID();
    const { error } = await this.db
      .from('mock_booking_session')
      .insert({ id, account_id: accountId, status: 'pending' });
    if (error) this.fail('createBooking', error.message);
    const clientUrl = `/consult/book/mock?booking=${id}&return=${encodeURIComponent(returnUrl)}`;
    return { bookingId: id, clientUrl };
  }

  async getBookingStatus(bookingId: string): Promise<BookingResult> {
    const { data, error } = await this.db
      .from('mock_booking_session')
      .select('*')
      .eq('id', bookingId)
      .maybeSingle();
    if (error) this.fail('getBookingStatus', error.message);
    if (!data) this.fail('getBookingStatus', `unknown booking ${bookingId}`);
    return {
      status: data.status as BookingResult['status'],
      slotAt: data.slot_at ?? undefined,
    };
  }

  // MOCK-ONLY: simulate the user picking a slot on the hosted page and the
  // provider confirming the booking. Not on the BookingAdapter interface by
  // design. `slotAt` is supplied by the caller (no ambient clock here).
  async markBooked(bookingId: string, slotAt: string): Promise<void> {
    const { data, error } = await this.db
      .from('mock_booking_session')
      .select('id')
      .eq('id', bookingId)
      .maybeSingle();
    if (error) this.fail('markBooked', error.message);
    if (!data) this.fail('markBooked', `unknown booking ${bookingId}`);

    const { error: upErr } = await this.db
      .from('mock_booking_session')
      .update({ status: 'booked', slot_at: slotAt })
      .eq('id', bookingId);
    if (upErr) this.fail('markBooked', upErr.message);
  }
}
