import { afterAll, describe, expect, it } from 'vitest';
import { readEnv } from '../src/lib/env';
import { createAdminClient } from '../src/lib/supabase/admin';
import { getScreening } from '../src/lib/adapters/factory';
import { MockCore } from '../src/lib/adapters/mock-core';
import { getScreeningReview } from '../src/lib/screening/review';
import {
  attachScreeningResults,
  orderScreeningKit,
} from '../src/lib/screening/order';
import { assessWeightEligibility, weightCheckFromAnswers } from '../src/lib/intake/weight';
import { ensureAccount, setCorePatientId, setJourney } from '../src/lib/accounts';

// ===========================================================================
// Weight roadmap P3 — bloods surfaced for the clinician + the Weight/BMI check.
// The console pages are thin wrappers over these two loaders; testing the loaders
// is the proof the console shows the panel and blocks the decision correctly.
// ===========================================================================

describe('assessWeightEligibility (pure Weight/BMI check)', () => {
  it('BMI >= 30 is eligible', () => {
    expect(assessWeightEligibility({ bmi: 31 }).eligible).toBe(true);
    expect(assessWeightEligibility({ bmi: 30 }).eligible).toBe(true);
  });
  it('BMI 27-29.9 is eligible ONLY with a related condition', () => {
    expect(assessWeightEligibility({ bmi: 28, hasRelatedCondition: true }).eligible).toBe(true);
    expect(assessWeightEligibility({ bmi: 28, hasRelatedCondition: false }).eligible).toBe(false);
  });
  it('BMI below 27 is not eligible', () => {
    expect(assessWeightEligibility({ bmi: 24, hasRelatedCondition: true }).eligible).toBe(false);
  });
  it('a missing / invalid BMI is not eligible', () => {
    expect(assessWeightEligibility({ bmi: NaN }).eligible).toBe(false);
    expect(assessWeightEligibility({ bmi: 0 }).eligible).toBe(false);
  });
});

describe('weightCheckFromAnswers (console helper)', () => {
  it('returns null when there is no BMI (e.g. a menopause intake)', () => {
    expect(weightCheckFromAnswers(null)).toBeNull();
    expect(weightCheckFromAnswers({ symptoms: [] })).toBeNull();
  });
  it('classifies when a BMI is present', () => {
    const wc = weightCheckFromAnswers({ bmi: 32, hasRelatedCondition: false });
    expect(wc?.bmi).toBe(32);
    expect(wc?.eligibility.eligible).toBe(true);
  });
});

const env = { ...readEnv(), CORE_IMPL: 'mock', SCREENING_IMPL: 'mock' };
const admin = createAdminClient(env);
const core = new MockCore(admin);
const createdAccounts: string[] = [];

afterAll(async () => {
  for (const id of createdAccounts) {
    await admin.from('account').delete().eq('id', id);
  }
});

async function patientAtIntakeSubmitted(): Promise<{ accountId: string; corePatientId: string }> {
  const account = await ensureAccount(admin, crypto.randomUUID());
  createdAccounts.push(account.id);
  const corePatientId = await core.createPatient({ fullName: 'Review Test Patient' });
  await setCorePatientId(admin, account.id, corePatientId);
  await setJourney(admin, account.id, 'intake_submitted', null);
  return { accountId: account.id, corePatientId };
}

describe('getScreeningReview: the clinician console view of the bloods', () => {
  it('no screening -> not required, not blocked, no panel', { timeout: 60_000 }, async () => {
    const account = await ensureAccount(admin, crypto.randomUUID());
    createdAccounts.push(account.id);
    const screening = getScreening(env, admin);
    const review = await getScreeningReview(admin, screening, account.id);
    expect(review).toEqual({ required: false, status: null, ready: false, blocked: false, panel: null });
  });

  it('bloods pending -> required, BLOCKED, no panel yet', { timeout: 60_000 }, async () => {
    const screening = getScreening(env, admin);
    const { accountId, corePatientId } = await patientAtIntakeSubmitted();
    await orderScreeningKit(admin, screening, accountId, corePatientId); // status kit_sent
    const review = await getScreeningReview(admin, screening, accountId);
    expect(review.required).toBe(true);
    expect(review.ready).toBe(false);
    expect(review.blocked).toBe(true);
    expect(review.panel).toBeNull();
  });

  it('bloods in -> required, NOT blocked, panel surfaced', { timeout: 60_000 }, async () => {
    const screening = getScreening(env, admin);
    const { accountId, corePatientId } = await patientAtIntakeSubmitted();
    const kitRef = await orderScreeningKit(admin, screening, accountId, corePatientId);
    // Drive the provider to results_ready (mock affordance), then reflect in the app.
    await (screening as import('../src/lib/adapters/mock-screening').MockScreening).advanceKit(
      kitRef,
      new Date().toISOString(),
    );
    await (screening as import('../src/lib/adapters/mock-screening').MockScreening).advanceKit(
      kitRef,
      new Date().toISOString(),
    );
    await setJourney(admin, accountId, 'sample_received', null); // move journey along for attach
    await attachScreeningResults(admin, accountId, kitRef);

    const review = await getScreeningReview(admin, screening, accountId);
    expect(review.required).toBe(true);
    expect(review.ready).toBe(true);
    expect(review.blocked).toBe(false);
    expect((review.panel ?? []).map((m) => m.marker).sort()).toEqual([
      'cholesterol',
      'hba1c',
      'liver',
      'thyroid',
    ]);
  });
});
