import type { SupabaseClient } from '@supabase/supabase-js';
import type { VerificationStatus } from './adapters/identity';
import {
  advanceJourney,
  getJourney,
  setIdVerificationStatus,
} from './accounts';

// Records the latest provider status against the id_verification pointer and,
// when verified, advances the journey id_pending -> id_verified. Idempotent:
// the verified branch runs only while the journey is still id_pending, so the
// webhook and the return-page poll can both fire without a double transition or
// an IllegalTransitionError. Returns the resulting (or unchanged) status.
export async function finaliseVerification(
  admin: SupabaseClient,
  accountId: string,
  providerRef: string,
  status: VerificationStatus,
): Promise<VerificationStatus> {
  await setIdVerificationStatus(admin, providerRef, status);

  if (status === 'verified') {
    const journey = await getJourney(admin, accountId);
    if (journey?.state === 'id_pending') {
      await advanceJourney(admin, accountId, 'id_verified');
    }
  }
  return status;
}
