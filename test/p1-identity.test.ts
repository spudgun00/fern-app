import { afterAll, describe, expect, it } from 'vitest';
import { readEnv } from '../src/lib/env';
import { createAdminClient } from '../src/lib/supabase/admin';
import { MockIdentity } from '../src/lib/adapters/mock-identity';
import type { ClinicalCoreAdapter } from '../src/lib/adapters/clinical-core';
import { ensureCorePatient } from '../src/lib/onboarding';
import { finaliseVerification } from '../src/lib/verification';
import {
  ALLOWED_TRANSITIONS,
  canTransition,
} from '../src/lib/journey/machine';
import { JOURNEY_STATES, type JourneyState } from '../src/lib/journey/states';
import {
  ensureAccount,
  getJourney,
  getLatestIdVerification,
  recordGpSharing,
  recordIdVerification,
  setJourney,
} from '../src/lib/accounts';

// All of P1's app-DB-backed behaviour, proven end to end. Uses a throwaway
// account (random auth_user_id, no auth user needed) and cleans up after.
const env = { ...readEnv(), IDENTITY_IMPL: 'mock' };
const admin = createAdminClient(env);
const authUserId = crypto.randomUUID();
let accountId = '';

afterAll(async () => {
  if (!accountId) return;
  // mock_identity_verification has no FK, delete explicitly; the rest cascades
  // from account.
  await admin.from('mock_identity_verification').delete().eq('account_id', accountId);
  await admin.from('account').delete().eq('id', accountId);
});

describe('P1 identity verification through the IdentityAdapter', () => {
  it('round-trips MockIdentity and advances id_pending -> id_verified', async () => {
    const account = await ensureAccount(admin, authUserId);
    accountId = account.id;

    const identity = new MockIdentity(admin);
    const session = await identity.createVerificationSession(accountId, '/account/verify/complete');
    expect(session.sessionId).toBeTruthy();
    expect(session.clientUrl).toContain(session.sessionId);

    await recordIdVerification(admin, accountId, session.sessionId, 'requires_input');
    expect(await identity.getVerificationStatus(session.sessionId)).toBe('requires_input');

    // Move to id_pending, as the verify-start route does.
    await setJourney(admin, accountId, 'id_pending', null);

    // Not verified yet -> no transition.
    await finaliseVerification(admin, accountId, session.sessionId, 'requires_input');
    expect((await getJourney(admin, accountId))?.state).toBe('id_pending');

    // Provider verifies -> finalise advances exactly once and is idempotent.
    await identity.markVerified(session.sessionId);
    expect(await identity.getVerificationStatus(session.sessionId)).toBe('verified');

    await finaliseVerification(admin, accountId, session.sessionId, 'verified');
    expect((await getJourney(admin, accountId))?.state).toBe('id_verified');

    // Second finalise (e.g. webhook after the return-page poll) must not throw
    // or change state.
    await finaliseVerification(admin, accountId, session.sessionId, 'verified');
    expect((await getJourney(admin, accountId))?.state).toBe('id_verified');

    // The stored pointer reflects the final status.
    expect((await getLatestIdVerification(admin, accountId))?.status).toBe('verified');
  });
});

describe('P1 GP info-sharing (hard line: refusal needs a recorded risk note)', () => {
  it('records consent without a note', async () => {
    const account = await ensureAccount(admin, authUserId);
    await expect(recordGpSharing(admin, account.id, 'consent', null)).resolves.toBeUndefined();
  });

  it('rejects a refusal with no risk note (server-side, not just the form)', async () => {
    const account = await ensureAccount(admin, authUserId);
    await expect(recordGpSharing(admin, account.id, 'refused', '   ')).rejects.toThrow(/risk note/i);
  });

  it('records a refusal that carries a risk note', async () => {
    const account = await ensureAccount(admin, authUserId);
    await expect(
      recordGpSharing(admin, account.id, 'refused', 'Patient declined; advised of continuity risk.'),
    ).resolves.toBeUndefined();
  });

  it('the DB CHECK also rejects a refusal with a null note (defence in depth)', async () => {
    const account = await ensureAccount(admin, authUserId);
    const { error } = await admin
      .from('gp_sharing')
      .insert({ account_id: account.id, decision: 'refused', risk_note: null });
    expect(error).toBeTruthy();
  });
});

describe('P1 profile maps a corePatientId exactly once (idempotent)', () => {
  it('does not create a second core patient on re-submit', async () => {
    const account = await ensureAccount(admin, authUserId);

    let creates = 0;
    const countingCore = {
      async createPatient() {
        creates += 1;
        return crypto.randomUUID();
      },
    } as unknown as ClinicalCoreAdapter;

    const first = await ensureCorePatient(admin, countingCore, account.id, { fullName: 'A' });
    const second = await ensureCorePatient(admin, countingCore, account.id, { fullName: 'A' });

    expect(creates).toBe(1);
    expect(first).toBe(second);
  });
});

describe('P1 hard line: ID gate is structural in the state machine', () => {
  it('id_verified is reachable only from id_pending', () => {
    const predecessors = JOURNEY_STATES.filter((from) =>
      ALLOWED_TRANSITIONS[from].includes('id_verified'),
    );
    expect(predecessors).toEqual(['id_pending']);
  });

  it('intake_started (the first clinical step) is reachable only from id_verified', () => {
    const predecessors = JOURNEY_STATES.filter((from) =>
      ALLOWED_TRANSITIONS[from].includes('intake_started'),
    );
    expect(predecessors).toEqual(['id_verified']);
    // No verification skip exists.
    for (const from of JOURNEY_STATES) {
      if (from === 'id_verified') continue;
      expect(canTransition(from as JourneyState, 'intake_started')).toBe(false);
    }
  });
});

// HARD LINE made an explicit, executable check (not just a schema comment): the
// app DB stores NO document images and NO extracted ID PII — only a provider
// pointer + status. We assert the exact column sets of the P1 app-DB tables and
// scan them against a denylist of PII / document / clinical field names.
describe('P1 hard line: app DB holds no ID document images or extracted PII', () => {
  const PII_DENYLIST =
    /image|photo|selfie|document|scan|passport|national_id|nationalid|biometric|face|first_name|last_name|full_name|surname|forename|dob|date_of_birth|address|extracted|answers|diagnosis/i;

  it('id_verification has exactly {id, account_id, provider_ref, status, created_at}', async () => {
    const account = await ensureAccount(admin, authUserId);
    await recordIdVerification(admin, account.id, 'sess_pii_check', 'verified');
    const { data, error } = await admin
      .from('id_verification')
      .select('*')
      .eq('account_id', account.id)
      .eq('provider_ref', 'sess_pii_check')
      .single();
    expect(error).toBeFalsy();

    const cols = Object.keys(data!).sort();
    expect(cols).toEqual(['account_id', 'created_at', 'id', 'provider_ref', 'status']);
    for (const col of cols) {
      expect(col, `id_verification.${col} looks like PII/document data`).not.toMatch(PII_DENYLIST);
    }
    // Only the pointer + status carry information.
    expect(data!.provider_ref).toBe('sess_pii_check');
    expect(data!.status).toBe('verified');
  });

  it('gp_sharing holds only the consent decision + risk note, no clinical answers', async () => {
    const account = await ensureAccount(admin, authUserId);
    await recordGpSharing(admin, account.id, 'consent', null);
    const { data, error } = await admin
      .from('gp_sharing')
      .select('*')
      .eq('account_id', account.id)
      .limit(1)
      .single();
    expect(error).toBeFalsy();

    const cols = Object.keys(data!).sort();
    expect(cols).toEqual(['account_id', 'decision', 'id', 'recorded_at', 'risk_note']);
    for (const col of cols) {
      expect(col, `gp_sharing.${col} looks like PII/clinical data`).not.toMatch(PII_DENYLIST);
    }
  });
});
