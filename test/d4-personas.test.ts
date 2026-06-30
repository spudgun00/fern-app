import { afterAll, describe, expect, it } from 'vitest';
import { readEnv } from '../src/lib/env';
import { createAdminClient } from '../src/lib/supabase/admin';
import { MockCore } from '../src/lib/adapters/mock-core';
import {
  PERSONAS,
  MOCK_TABLES,
  applyPersona,
  resetAndSweep,
  getPersona,
  type DemoRole,
} from '../src/lib/demo/personas';
import {
  ensureAccount,
  getAccountById,
  getJourney,
  getMembership,
  type Account,
} from '../src/lib/accounts';

// D4 runs entirely on the mock adapters (the keyless self-walk). Force them so a
// stray local .dev.vars flag cannot flip a service mid-test.
const env = {
  ...readEnv(),
  CORE_IMPL: 'mock',
  IDENTITY_IMPL: 'mock',
  PAYMENTS_IMPL: 'mock',
  BOOKING_IMPL: 'mock',
  VIDEO_IMPL: 'mock',
  DISPENSING_IMPL: 'mock',
};
const admin = createAdminClient(env);
const core = new MockCore(admin);

// Each network round-trip to Supabase is slow; a persona apply chains several.
// Give the seeding tests room and the cleanup hook room.
const LONG = 120_000;

const created: string[] = [];

async function freshAccount(): Promise<Account> {
  const account = await ensureAccount(admin, crypto.randomUUID());
  created.push(account.id);
  return account;
}

// States from which (or at which) a script has been decided/issued. NO persona
// seed may land here: a persona drives the patient TO a clinician decision, it
// never takes it.
const PRESCRIBING_STATES = ['approved', 'consult_done', 'rx_issued', 'dispensing', 'delivered'];

// The expected landing per persona (state, lane, role) — the point each path
// drops the reviewer at.
const EXPECTED: Record<
  string,
  { state: string; lane: string | null; role: DemoRole; queueItems: number }
> = {
  'fast-approve': { state: 'in_review_queue', lane: 'fast', role: 'clinician', queueItems: 1 },
  escalate: { state: 'in_review_queue', lane: 'fast', role: 'clinician', queueItems: 1 },
  refuse: { state: 'in_review_queue', lane: 'fast', role: 'clinician', queueItems: 1 },
  'full-consult': { state: 'intake_submitted', lane: 'full', role: 'patient', queueItems: 0 },
  'red-flag': { state: 'intake_submitted', lane: null, role: 'patient', queueItems: 0 },
  cancel: { state: 'active_member', lane: null, role: 'patient', queueItems: 0 },
};

afterAll(async () => {
  if (created.length === 0) return;
  // Batch cleanup (far fewer round-trips than per-account sweeps). mock_core_*
  // rows are keyed by core_patient_id (no account FK), so sweep them by the
  // seeded patients; the rest by account; then delete the accounts (cascades the
  // app-DB pointer rows).
  const { data: accounts } = await admin
    .from('account')
    .select('id, core_patient_id')
    .in('id', created);
  const cpids = (accounts ?? []).map((a) => a.core_patient_id).filter(Boolean) as string[];
  if (cpids.length > 0) {
    for (const t of [
      'mock_core_intake',
      'mock_core_consult_note',
      'mock_core_prescription',
      'mock_core_repeat_request',
    ]) {
      await admin.from(t).delete().in('core_patient_id', cpids);
    }
    await admin.from('mock_core_patient').delete().in('id', cpids);
  }
  for (const t of ['mock_identity_verification', 'mock_payment_session', 'mock_booking_session']) {
    await admin.from(t).delete().in('account_id', created);
  }
  await admin.from('account').delete().in('id', created);
}, LONG);

// ===========================================================================
// The persona registry is well-formed (no network).
// ===========================================================================
describe('D4 persona registry', () => {
  it('exposes the six curated paths with unique ids', () => {
    expect(PERSONAS).toHaveLength(6);
    const ids = PERSONAS.map((p) => p.id).sort();
    expect(new Set(ids).size).toBe(6);
    expect(ids).toEqual(['cancel', 'escalate', 'fast-approve', 'full-consult', 'red-flag', 'refuse']);
  });

  it('every persona has the fields the panel + router need', () => {
    for (const p of PERSONAS) {
      expect(p.name).toBeTruthy();
      expect(p.title).toBeTruthy();
      expect(p.summary).toBeTruthy();
      expect(p.walk).toBeTruthy();
      expect(p.landing.startsWith('/')).toBe(true);
      expect(['patient', 'clinician']).toContain(p.role);
    }
  });

  it('getPersona resolves a known id and rejects an unknown one', () => {
    expect(getPersona('fast-approve')?.id).toBe('fast-approve');
    expect(getPersona('nope')).toBeUndefined();
  });

  it('MOCK_TABLES lists only the throwaway namespaced mock_* tables', () => {
    expect([...MOCK_TABLES].sort()).toEqual(
      [
        'mock_booking_session',
        'mock_core_consult_note',
        'mock_core_intake',
        'mock_core_patient',
        'mock_core_prescription',
        'mock_core_repeat_request',
        'mock_dispense',
        'mock_identity_verification',
        'mock_payment_session',
      ].sort(),
    );
    // No app-DB table, and certainly no auth table, is in the purge set.
    for (const t of MOCK_TABLES) expect(t.startsWith('mock_')).toBe(true);
  });
});

// ===========================================================================
// Each persona lands at the expected point AND honours the hard line: no
// prescribing state, no issued script. One apply per persona (kept cheap).
// ===========================================================================
describe('D4 persona seeding', () => {
  for (const persona of PERSONAS) {
    it(
      `${persona.id} lands at its expected point with no auto-issued script`,
      async () => {
        const account = await freshAccount();
        await applyPersona(env, admin, account.auth_user_id, persona.id);
        const after = (await getAccountById(admin, account.id))!;
        const journey = await getJourney(admin, account.id);
        const exp = EXPECTED[persona.id];

        // Landed where the path expects.
        expect(journey?.state).toBe(exp.state);
        expect(journey?.lane ?? null).toBe(exp.lane);
        expect(after.role).toBe(exp.role);
        const { data: queue } = await admin
          .from('queue_item')
          .select('status')
          .eq('account_id', account.id)
          .eq('status', 'pending');
        expect((queue ?? []).length).toBe(exp.queueItems);

        // HARD LINE: never a prescribing state, never a script in the core.
        expect(
          PRESCRIBING_STATES.includes(journey?.state ?? ''),
          `${persona.id} must not land in a prescribing state (was ${journey?.state})`,
        ).toBe(false);
        if (after.core_patient_id) {
          const scripts = await core.getPrescriptions(after.core_patient_id);
          expect(scripts.length, `${persona.id} must not have an issued script`).toBe(0);
        }
      },
      LONG,
    );
  }

  it(
    'red-flag seeds a stop + signpost routing decision in the core',
    async () => {
      const account = await freshAccount();
      await applyPersona(env, admin, account.auth_user_id, 'red-flag');
      const cpid = (await getAccountById(admin, account.id))!.core_patient_id!;
      const { data } = await admin
        .from('mock_core_intake')
        .select('payload')
        .eq('core_patient_id', cpid);
      const routing = (data?.[0]?.payload as any)?.routing;
      expect(routing?.outcome).toBe('stop');
      expect(routing?.signpost).toBeTruthy();
    },
    LONG,
  );

  it(
    'cancel seeds an active membership with a provider customer pointer',
    async () => {
      const account = await freshAccount();
      await applyPersona(env, admin, account.auth_user_id, 'cancel');
      const membership = await getMembership(admin, account.id);
      expect(membership?.status).toBe('active');
      expect(membership?.provider_customer_ref).toBeTruthy();
    },
    LONG,
  );
});

// ===========================================================================
// CLEANUP: reset + per-account mock_* sweep returns a genuine clean slate.
// ===========================================================================
describe('D4 reset + sweep — a genuine clean slate', () => {
  it(
    'clears the journey, the core mapping, the app-DB pointers and the mock_* rows',
    async () => {
      const account = await freshAccount();
      await applyPersona(env, admin, account.auth_user_id, 'fast-approve');
      const seeded = (await getAccountById(admin, account.id))!;
      const cpid = seeded.core_patient_id!;
      expect(cpid).toBeTruthy();

      // The seed left a mock core patient + intake.
      expect((await admin.from('mock_core_patient').select('id').eq('id', cpid)).data?.length).toBe(1);
      expect(
        (await admin.from('mock_core_intake').select('id').eq('core_patient_id', cpid)).data?.length,
      ).toBe(1);

      await resetAndSweep(admin, seeded);

      // Journey + mapping reset.
      const journey = await getJourney(admin, account.id);
      expect(journey?.state).toBe('registered');
      expect(journey?.lane).toBeNull();
      expect((await getAccountById(admin, account.id))?.core_patient_id).toBeNull();

      // App-DB pointer rows cleared.
      for (const table of ['queue_item', 'intake_ref', 'id_verification', 'gp_sharing']) {
        const { data } = await admin.from(table).select('id').eq('account_id', account.id);
        expect((data ?? []).length, `${table} should be empty after reset`).toBe(0);
      }

      // The mock_* clinical rows for the prior patient are gone (the sweep).
      expect((await admin.from('mock_core_patient').select('id').eq('id', cpid)).data?.length).toBe(0);
      expect(
        (await admin.from('mock_core_intake').select('id').eq('core_patient_id', cpid)).data?.length,
      ).toBe(0);
    },
    LONG,
  );

  it(
    're-applying a persona after a walk does not leak the prior mock intake',
    async () => {
      const account = await freshAccount();
      await applyPersona(env, admin, account.auth_user_id, 'fast-approve');
      const first = (await getAccountById(admin, account.id))!.core_patient_id!;

      await applyPersona(env, admin, account.auth_user_id, 'full-consult');
      const second = (await getAccountById(admin, account.id))!.core_patient_id!;

      // A fresh patient, and the first patient's mock intake was swept.
      expect(second).not.toBe(first);
      expect(
        (await admin.from('mock_core_intake').select('id').eq('core_patient_id', first)).data?.length,
      ).toBe(0);
      // Exactly one live intake (the current walk's).
      expect(
        (await admin.from('mock_core_intake').select('id').eq('core_patient_id', second)).data?.length,
      ).toBe(1);
    },
    LONG,
  );
});
