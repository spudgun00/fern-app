import { afterAll, describe, expect, it } from 'vitest';
import { readEnv } from '../src/lib/env';
import { createAdminClient } from '../src/lib/supabase/admin';
import { MockCore } from '../src/lib/adapters/mock-core';
import { MockPayments } from '../src/lib/adapters/mock-payments';
import { getScreening } from '../src/lib/adapters/factory';
import { decideClinicianAction } from '../src/lib/clinician/decide';
import { submitIntake } from '../src/lib/intake/submit';
import { submitWeightIntake } from '../src/lib/weight/submit';
import { refundOnRefusal } from '../src/lib/weight/refund';
import {
  routeWeightIntake,
  type WeightIntakeAnswers,
} from '../src/lib/intake/weight-routing';
import type { IntakeAnswers } from '../src/lib/intake/routing';
import {
  ensureAccount,
  getJourney,
  getLatestIntakeRef,
  getLatestPaymentRef,
  getLatestScreeningRef,
  hasPaidTreatment,
  recordPaymentRef,
  recordScreeningRef,
  setCorePatientId,
  setJourney,
  setPaymentRefStatus,
  setScreeningRefStatus,
} from '../src/lib/accounts';

// ===========================================================================
// Weight roadmap P4 — the GLP intake lane (contraindication screen) + PAY-FIRST
// checkout + AUTOMATIC refund-on-refusal. The pay-first model is only acceptable
// because the refund is instant and built in; these tests prove it.
// ===========================================================================

// ---- pure contraindication screen (no DB) ---------------------------------
function cleanWeightAnswers(over: Partial<WeightIntakeAnswers> = {}): WeightIntakeAnswers {
  return {
    bmi: 32,
    hasRelatedCondition: false,
    currentPregnancy: false,
    planningPregnancy: false,
    breastfeeding: false,
    eatingDisorderHistory: false,
    thyroidCancerHistory: false,
    pancreatitisHistory: false,
    ...over,
  };
}

describe('routeWeightIntake (the GLP contraindication screen)', () => {
  it('a clean answer set proceeds into screening', () => {
    const d = routeWeightIntake(cleanWeightAnswers());
    expect(d.outcome).toBe('proceed');
    expect(d.reasons).toEqual([]);
    expect(d.eligibility.eligible).toBe(true);
  });

  it('any absolute contraindication STOPS with a GP signpost', () => {
    const flags: Array<keyof WeightIntakeAnswers> = [
      'currentPregnancy',
      'planningPregnancy',
      'breastfeeding',
      'eatingDisorderHistory',
      'thyroidCancerHistory',
      'pancreatitisHistory',
    ];
    for (const flag of flags) {
      const d = routeWeightIntake(cleanWeightAnswers({ [flag]: true } as Partial<WeightIntakeAnswers>));
      expect(d.outcome, `${flag} must stop`).toBe('stop');
      expect(d.reasons.length).toBeGreaterThan(0);
      expect(d.signpost).toMatch(/GP/);
    }
  });

  it('an out-of-range BMI does NOT stop (guidance only; a clinician decides)', () => {
    const d = routeWeightIntake(cleanWeightAnswers({ bmi: 24 }));
    expect(d.outcome).toBe('proceed');
    expect(d.eligibility.eligible).toBe(false);
  });
});

// ---- integration (Supabase-backed) ----------------------------------------
const env = { ...readEnv(), CORE_IMPL: 'mock', SCREENING_IMPL: 'mock', PAYMENTS_IMPL: 'mock' };
const admin = createAdminClient(env);
const core = new MockCore(admin);
const payments = new MockPayments(admin);
const createdAccounts: string[] = [];

afterAll(async () => {
  for (const id of createdAccounts) {
    await admin.from('account').delete().eq('id', id);
  }
});

async function freshClinician(): Promise<string> {
  const account = await ensureAccount(admin, crypto.randomUUID());
  createdAccounts.push(account.id);
  await admin.from('account').update({ role: 'clinician' }).eq('id', account.id);
  return account.id;
}

// Pay up front for treatment (pay-first): a paid treatment payment_ref backed by
// a real mock provider session (so refund() can act on it). Returns the session id.
async function payFirstTreatment(accountId: string): Promise<string> {
  const session = await payments.createCheckout('treatment', accountId, '/weight');
  await recordPaymentRef(admin, accountId, 'treatment', session.sessionId, 'pending');
  await payments.markPaid(session.sessionId);
  await setPaymentRefStatus(admin, session.sessionId, 'paid');
  return session.sessionId;
}

function fastLaneAnswers(): IntakeAnswers {
  return {
    treatmentHistory: 'continuing',
    symptoms: ['hot_flushes'],
    monthsSinceLastPeriod: 18,
    bpSystolic: 124,
    bpDiastolic: 78,
    clotHistory: false,
    breastCancerHistory: false,
    liverDisease: false,
    unexplainedBleeding: false,
    currentPregnancy: false,
    suspectedClotSymptoms: false,
    undiagnosedBreastLump: false,
  };
}

// A weight patient in the review queue with the bloods in (results_ready) and a
// paid-up-front treatment charge.
async function paidScreenedWeightPatient() {
  const account = await ensureAccount(admin, crypto.randomUUID());
  createdAccounts.push(account.id);
  const corePatientId = await core.createPatient({ fullName: 'Pay-first Patient' });
  await setCorePatientId(admin, account.id, corePatientId);
  await setJourney(admin, account.id, 'id_verified', null);
  await submitIntake(admin, core, account.id, corePatientId, 'weight', fastLaneAnswers());
  const kitRef = crypto.randomUUID();
  await recordScreeningRef(admin, account.id, kitRef, 'kit_sent');
  await setScreeningRefStatus(admin, kitRef, 'results_ready'); // bloods in -> approve allowed
  await payFirstTreatment(account.id);
  const { data } = await admin
    .from('queue_item')
    .select('*')
    .eq('account_id', account.id)
    .single();
  return { accountId: account.id, corePatientId, queueItemId: data!.id as string };
}

describe('MockPayments.refund (the adapter refund path)', () => {
  it('refunds a paid session', { timeout: 60_000 }, async () => {
    const account = await ensureAccount(admin, crypto.randomUUID());
    createdAccounts.push(account.id);
    const session = await payments.createCheckout('treatment', account.id, '/x');
    await payments.markPaid(session.sessionId);
    await payments.refund(session.sessionId);
    const { data } = await admin
      .from('mock_payment_session')
      .select('status')
      .eq('id', session.sessionId)
      .single();
    expect(data!.status).toBe('refunded');
  });
});

describe('AUTOMATIC refund-on-refusal (pay-first weight lane)', () => {
  it('REFUSE refunds the pay-first charge automatically', { timeout: 60_000 }, async () => {
    const clinicianId = await freshClinician();
    const { accountId, queueItemId } = await paidScreenedWeightPatient();
    expect(await hasPaidTreatment(admin, accountId)).toBe(true);

    const result = await decideClinicianAction(
      admin,
      core,
      { clinicianAccountId: clinicianId, queueItemId, action: 'refuse', reason: 'not suitable' },
      payments,
    );

    expect(result.newState).toBe('refused');
    expect(result.refunded).toBe(true);
    // App-DB pointer flipped to refunded, and the provider session refunded.
    expect((await getLatestPaymentRef(admin, accountId, 'treatment'))?.status).toBe('refunded');
    const ref = await getLatestPaymentRef(admin, accountId, 'treatment');
    const { data } = await admin
      .from('mock_payment_session')
      .select('status')
      .eq('id', ref!.provider_ref!)
      .single();
    expect(data!.status).toBe('refunded');
  });

  it('APPROVE keeps the charge (no refund) and reaches rx_issued', { timeout: 60_000 }, async () => {
    const clinicianId = await freshClinician();
    const { accountId, queueItemId } = await paidScreenedWeightPatient();

    const result = await decideClinicianAction(
      admin,
      core,
      {
        clinicianAccountId: clinicianId,
        queueItemId,
        action: 'approve',
        reason: 'bloods in range; approve',
        rxItems: [{ name: 'Treatment', dose: 'as directed', quantity: 1 }],
      },
      payments,
    );

    expect(result.newState).toBe('rx_issued');
    expect(result.refunded).toBe(false);
    expect((await getLatestPaymentRef(admin, accountId, 'treatment'))?.status).toBe('paid');
  });

  it('refundOnRefusal is a no-op when nothing was paid up front', { timeout: 60_000 }, async () => {
    const account = await ensureAccount(admin, crypto.randomUUID());
    createdAccounts.push(account.id);
    expect(await refundOnRefusal(admin, payments, account.id)).toBe(false);
  });
});

describe('submitWeightIntake (the GLP intake lane end to end)', () => {
  async function verifiedPatient() {
    const account = await ensureAccount(admin, crypto.randomUUID());
    createdAccounts.push(account.id);
    const corePatientId = await core.createPatient({ fullName: 'Weight Intake Patient' });
    await setCorePatientId(admin, account.id, corePatientId);
    await setJourney(admin, account.id, 'id_verified', null);
    return { accountId: account.id, corePatientId };
  }

  it('proceed -> orders the screening kit (intake_submitted -> screening_kit_sent)', { timeout: 60_000 }, async () => {
    const screening = getScreening(env, admin);
    const { accountId, corePatientId } = await verifiedPatient();
    const res = await submitWeightIntake(
      admin,
      core,
      screening,
      accountId,
      corePatientId,
      cleanWeightAnswers(),
    );
    expect(res.decision.outcome).toBe('proceed');
    expect(res.kitRef).toBeTruthy();
    expect((await getJourney(admin, accountId))?.state).toBe('screening_kit_sent');
    expect((await getLatestScreeningRef(admin, accountId))?.status).toBe('kit_sent');
    expect((await getLatestIntakeRef(admin, accountId))?.outcome).toBe('fast');
  });

  it('a contraindication STOPS at intake_submitted with no kit', { timeout: 60_000 }, async () => {
    const screening = getScreening(env, admin);
    const { accountId, corePatientId } = await verifiedPatient();
    const res = await submitWeightIntake(
      admin,
      core,
      screening,
      accountId,
      corePatientId,
      cleanWeightAnswers({ eatingDisorderHistory: true }),
    );
    expect(res.decision.outcome).toBe('stop');
    expect(res.kitRef).toBeNull();
    expect((await getJourney(admin, accountId))?.state).toBe('intake_submitted');
    expect((await getLatestScreeningRef(admin, accountId))).toBeNull();
    expect((await getLatestIntakeRef(admin, accountId))?.outcome).toBe('stop');
  });
});
