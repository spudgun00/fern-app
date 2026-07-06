import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureAccount, getJourney } from './accounts';
import { postLoginDestination } from './start';

// Resolve where an authenticated user should land: their current onboarding step
// (or the clinician console), never the P0 dev harness. Used by the log-in route
// and the already-signed-in guards on /login and /signup, so all three agree.
// ensureAccount also covers users seeded out-of-band (e.g. a clinician row).
export async function authedLandingPath(
  admin: SupabaseClient,
  authUserId: string,
): Promise<string> {
  const account = await ensureAccount(admin, authUserId);
  const journey = await getJourney(admin, account.id);
  return postLoginDestination({ role: account.role, state: journey?.state ?? null });
}
