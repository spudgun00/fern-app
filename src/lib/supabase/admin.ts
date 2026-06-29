import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppEnv } from '../env';

// Privileged, server-only client using the service_role key. Bypasses RLS.
// All app-DB and mock_* access this phase goes through this client, server-side.
// NEVER import this into any client-exposed code, and never expose the key.
export function createAdminClient(env: AppEnv): SupabaseClient {
  return createClient(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
