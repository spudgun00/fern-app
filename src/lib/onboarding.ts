import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClinicalCoreAdapter, PatientProfile } from './adapters/clinical-core';
import { getAccountById, setCorePatientId } from './accounts';

// Creates the clinical-core patient for an account ONCE and maps corePatientId
// onto the account. Idempotent: re-reads the account and short-circuits if a
// core patient is already mapped, so a re-submitted profile never creates a
// second core patient. Demographics go to the CORE, never the app DB.
export async function ensureCorePatient(
  admin: SupabaseClient,
  core: ClinicalCoreAdapter,
  accountId: string,
  profile: PatientProfile,
): Promise<string> {
  const account = await getAccountById(admin, accountId);
  if (!account) throw new Error(`ensureCorePatient: no account ${accountId}`);
  if (account.core_patient_id) return account.core_patient_id;

  const corePatientId = await core.createPatient(profile);
  await setCorePatientId(admin, accountId, corePatientId);
  return corePatientId;
}
