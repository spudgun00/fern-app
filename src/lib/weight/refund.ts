import type { SupabaseClient } from '@supabase/supabase-js';
import type { PaymentsAdapter } from '../adapters/payments';
import { getLatestPaymentRef, setPaymentRefStatus } from '../accounts';

// ===========================================================================
// Automatic refund-on-refusal (weight roadmap P4). Weight is PAY-FIRST: the
// patient pays for treatment at checkout, BEFORE a clinician has decided. That
// is only acceptable because the refund is INSTANT and BUILT IN — not a manual
// back-office step. This is that path, in code.
//
// When a clinician REFUSES a patient who paid up front, the treatment charge is
// returned immediately: the PaymentsAdapter refunds the provider session and the
// app-DB pointer is marked refunded. Composed into the refuse branch of the
// clinician decision (decideClinicianAction / decideConsultAction), so no refusal
// can leave a paid patient un-refunded.
//
// No treatment payment (e.g. a menopause patient, or a weight patient who has not
// paid) -> a no-op, so it is safe to call on every refusal.
// ===========================================================================
export async function refundOnRefusal(
  admin: SupabaseClient,
  payments: PaymentsAdapter,
  accountId: string,
): Promise<boolean> {
  const ref = await getLatestPaymentRef(admin, accountId, 'treatment');
  if (ref?.status !== 'paid' || !ref.provider_ref) {
    return false; // nothing paid up front -> nothing to refund
  }
  await payments.refund(ref.provider_ref);
  await setPaymentRefStatus(admin, ref.provider_ref, 'refunded');
  return true;
}
