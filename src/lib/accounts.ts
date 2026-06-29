import type { SupabaseClient } from '@supabase/supabase-js';
import type { JourneyState, Lane } from './journey/states';

// App-DB helpers. NON-CLINICAL state only. All access is server-side via the
// service_role admin client.

export interface Account {
  id: string;
  auth_user_id: string;
  role: 'patient' | 'clinician';
  core_patient_id: string | null;
  created_at: string;
}

export interface Journey {
  id: string;
  account_id: string;
  state: JourneyState;
  lane: Lane | null;
  updated_at: string;
}

export async function getAccountByUser(
  db: SupabaseClient,
  authUserId: string,
): Promise<Account | null> {
  const { data, error } = await db
    .from('account')
    .select('*')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (error) throw new Error(`getAccountByUser: ${error.message}`);
  return (data as Account) ?? null;
}

// Creates the account (default role 'patient') and its journey row at
// 'registered' if they do not already exist. Idempotent.
export async function ensureAccount(
  db: SupabaseClient,
  authUserId: string,
): Promise<Account> {
  const existing = await getAccountByUser(db, authUserId);
  let account = existing;
  if (!account) {
    const { data, error } = await db
      .from('account')
      .insert({ auth_user_id: authUserId, role: 'patient' })
      .select('*')
      .single();
    if (error) throw new Error(`ensureAccount(account): ${error.message}`);
    account = data as Account;
  }

  const { data: journey, error: jErr } = await db
    .from('journey')
    .select('id')
    .eq('account_id', account.id)
    .maybeSingle();
  if (jErr) throw new Error(`ensureAccount(journey lookup): ${jErr.message}`);
  if (!journey) {
    const { error: insErr } = await db
      .from('journey')
      .insert({ account_id: account.id, state: 'registered' });
    if (insErr) throw new Error(`ensureAccount(journey insert): ${insErr.message}`);
  }

  return account;
}

export async function getJourney(
  db: SupabaseClient,
  accountId: string,
): Promise<Journey | null> {
  const { data, error } = await db
    .from('journey')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw new Error(`getJourney: ${error.message}`);
  return (data as Journey) ?? null;
}

export async function setJourney(
  db: SupabaseClient,
  accountId: string,
  state: JourneyState,
  lane: Lane | null,
): Promise<void> {
  const { error } = await db
    .from('journey')
    .update({ state, lane, updated_at: new Date().toISOString() })
    .eq('account_id', accountId);
  if (error) throw new Error(`setJourney: ${error.message}`);
}

export async function setCorePatientId(
  db: SupabaseClient,
  accountId: string,
  corePatientId: string | null,
): Promise<void> {
  const { error } = await db
    .from('account')
    .update({ core_patient_id: corePatientId })
    .eq('id', accountId);
  if (error) throw new Error(`setCorePatientId: ${error.message}`);
}
