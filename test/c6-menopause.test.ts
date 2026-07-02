import { afterAll, describe, expect, it } from 'vitest';
import { readEnv } from '../src/lib/env';
import { flagsFromEnv } from '../src/lib/cta';
import { createAdminClient } from '../src/lib/supabase/admin';
import { MockCore } from '../src/lib/adapters/mock-core';
import { canTransition, RX_ISSUED_PREDECESSORS } from '../src/lib/journey/machine';
import {
  getMenopauseCatalogue,
  getMenopauseProduct,
  isKnownProductId,
  HRT_PRODUCTS,
} from '../src/lib/menopause/catalogue';
import { routeMenopauseTreatment } from '../src/lib/menopause/treatment-intake';
import {
  submitMenopauseTreatment,
  treatmentStepMode,
  isTreatmentStepEligible,
  TREATMENT_STEP_PLACEHOLDER,
} from '../src/lib/menopause/treatment';
import { ensureAccount, getJourney, setCorePatientId, setJourney } from '../src/lib/accounts';

// ===========================================================================
// Checkout C6 — the menopause HRT treatment layer, behind menopauseRx (OFF by
// default, mirror of weightLossRx). This proves:
//   * flag OFF  -> the catalogue does not resolve; NO HRT name is produced; the
//     treatment step renders the labelled placeholder.
//   * flag ON   -> the catalogue + contraindication intake resolve; a product can
//     be selected AFTER approval, and selecting one NEVER reaches rx_issued (the
//     journey is unchanged; the clinician predecessors are untouched).
// ===========================================================================

const env = { ...readEnv(), CORE_IMPL: 'mock' };
const admin = createAdminClient(env);
const core = new MockCore(admin);
const createdAccounts: string[] = [];
const createdPatients: string[] = [];

const RX_ON = { menopauseRx: true };
const RX_OFF = { menopauseRx: false };

// Any HRT product name / type must NOT appear in flag-off output.
const HRT_TERMS =
  /estradiol|oestrogen|estrogen|progest|\bhrt\b|testosterone|levonorgestrel|micronised|patch|pessary/i;

afterAll(async () => {
  if (createdPatients.length > 0) {
    await admin.from('mock_core_intake').delete().in('core_patient_id', createdPatients);
    await admin.from('mock_core_patient').delete().in('id', createdPatients);
  }
  if (createdAccounts.length > 0) {
    // Account delete cascades journey.
    await admin.from('account').delete().in('id', createdAccounts);
  }
});

async function approvedMenopausePatient(): Promise<{ accountId: string; corePatientId: string }> {
  const account = await ensureAccount(admin, crypto.randomUUID());
  createdAccounts.push(account.id);
  const corePatientId = await core.createPatient({ fullName: 'C6 Menopause Patient' });
  createdPatients.push(corePatientId);
  await setCorePatientId(admin, account.id, corePatientId);
  // Place the patient at the clinician-decision state directly (setJourney is an
  // update, not a transition) — the point "after the screen is approved".
  await setJourney(admin, account.id, 'approved', 'fast');
  return { accountId: account.id, corePatientId };
}

function cleanAnswers(over: Record<string, unknown> = {}) {
  return {
    currentOrPastBreastCancer: false,
    oestrogenDependentCancer: false,
    activeVte: false,
    activeArterialDisease: false,
    activeLiverDisease: false,
    undiagnosedVaginalBleeding: false,
    pregnancy: false,
    hasUterus: true,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Flag OFF: the catalogue does not resolve and no HRT name is produced.
// ---------------------------------------------------------------------------
describe('C6 flag OFF: no HRT catalogue, no HRT name, placeholder stays', () => {
  it('the env default is OFF (MENOPAUSE_RX_ENABLED unset)', () => {
    // .dev.vars ships it false; readEnv defaults it false regardless.
    expect(flagsFromEnv(readEnv()).menopauseRx).toBe(false);
  });

  it('getMenopauseCatalogue returns [] and getMenopauseProduct returns null when off', () => {
    expect(getMenopauseCatalogue(RX_OFF)).toEqual([]);
    for (const p of HRT_PRODUCTS) {
      expect(getMenopauseProduct(p.id, RX_OFF)).toBeNull();
    }
  });

  it('no HRT term appears in ANY flag-off output (getters + placeholder)', () => {
    const offBlob = JSON.stringify(getMenopauseCatalogue(RX_OFF));
    expect(offBlob).not.toMatch(HRT_TERMS);
    expect(TREATMENT_STEP_PLACEHOLDER).not.toMatch(HRT_TERMS);
    expect(TREATMENT_STEP_PLACEHOLDER).toMatch(/pending menopause catalogue/i);
  });

  it('the treatment step renders the placeholder when off, at every state', () => {
    expect(treatmentStepMode(RX_OFF, 'approved')).toBe('placeholder');
    expect(treatmentStepMode(RX_OFF, 'intake_submitted')).toBe('placeholder');
    expect(treatmentStepMode(RX_OFF, null)).toBe('placeholder');
  });

  it('a selection is not recorded when off, even with a valid product id', async () => {
    const { accountId, corePatientId } = await approvedMenopausePatient();
    const result = await submitMenopauseTreatment(
      admin,
      core,
      RX_OFF,
      accountId,
      corePatientId,
      cleanAnswers({ selectedProductId: 'estradiol-patch' }),
    );
    // The valid id does not resolve under the off flag -> nothing selectable.
    expect(result.decision.selectedProductId).toBeNull();
    // And the journey is untouched.
    expect(result.stateBefore).toBe('approved');
    expect(result.stateAfter).toBe('approved');
  });
});

// ---------------------------------------------------------------------------
// Flag ON: catalogue + intake resolve; clinician / patient fields are separate.
// ---------------------------------------------------------------------------
describe('C6 flag ON: the HRT catalogue resolves (NICE NG23 / BMS categories)', () => {
  it('renders every category group with products when on', () => {
    const catalogue = getMenopauseCatalogue(RX_ON);
    expect(catalogue.length).toBe(5);
    const ids = catalogue.map((g) => g.category.id);
    expect(ids).toEqual([
      'systemic-oestrogen',
      'progestogen',
      'combined',
      'vaginal-oestrogen',
      'testosterone',
    ]);
    for (const group of catalogue) {
      expect(group.products.length).toBeGreaterThan(0);
    }
  });

  it('clinician-facing name and patient-facing description are SEPARATE fields', () => {
    for (const p of HRT_PRODUCTS) {
      expect(p.clinicianName.length).toBeGreaterThan(0);
      expect(p.patientName.length).toBeGreaterThan(0);
      expect(p.patientDescription.length).toBeGreaterThan(0);
      // The three are distinct: the clinician name is not the patient copy.
      expect(p.clinicianName).not.toBe(p.patientDescription);
      expect(p.clinicianName).not.toBe(p.patientName);
    }
    const patch = getMenopauseProduct('estradiol-patch', RX_ON);
    expect(patch?.clinicianName).toBe('Transdermal estradiol patch');
    expect(patch?.patientName).toBe('Oestrogen skin patch');
  });

  it('treatmentStepMode gates on approval when on', () => {
    expect(treatmentStepMode(RX_ON, 'approved')).toBe('catalogue');
    expect(treatmentStepMode(RX_ON, 'consult_done')).toBe('catalogue');
    expect(treatmentStepMode(RX_ON, 'intake_submitted')).toBe('not-eligible');
    expect(isTreatmentStepEligible('screening_kit_sent')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The treatment intake (pure): the contraindication + selection screen.
// ---------------------------------------------------------------------------
describe('C6 treatment intake: contraindication + selection screen', () => {
  it('a clear screen proceeds; a woman with a uterus gets the progestogen note', () => {
    const d = routeMenopauseTreatment(cleanAnswers({ selectedProductId: 'estradiol-patch' }));
    expect(d.outcome).toBe('proceed');
    expect(d.reasons).toEqual([]);
    expect(d.selectedProductId).toBe('estradiol-patch');
    expect(d.needsProgestogenNote).toBe(true);
  });

  it('hasUterus false drops the progestogen note (still proceeds)', () => {
    const d = routeMenopauseTreatment(cleanAnswers({ hasUterus: false }));
    expect(d.outcome).toBe('proceed');
    expect(d.needsProgestogenNote).toBe(false);
  });

  it('any contraindication STOPS with a signpost and holds no selection', () => {
    for (const flag of [
      'currentOrPastBreastCancer',
      'oestrogenDependentCancer',
      'activeVte',
      'activeArterialDisease',
      'activeLiverDisease',
      'undiagnosedVaginalBleeding',
      'pregnancy',
    ]) {
      const d = routeMenopauseTreatment(
        cleanAnswers({ [flag]: true, selectedProductId: 'estradiol-patch' }),
      );
      expect(d.outcome, `${flag} must stop`).toBe('stop');
      expect(d.reasons.length).toBeGreaterThan(0);
      expect(d.signpost).toBeTruthy();
      expect(d.selectedProductId).toBeNull();
    }
  });

  it('only a known catalogue id is accepted as a selection', () => {
    expect(isKnownProductId('estradiol-patch')).toBe(true);
    expect(isKnownProductId('mounjaro')).toBe(false);
    const d = routeMenopauseTreatment(cleanAnswers({ selectedProductId: 'not-a-real-id' }));
    expect(d.selectedProductId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// THE HARD LINE: selecting a treatment after approval does NOT reach rx_issued.
// ---------------------------------------------------------------------------
describe('C6 hard line: choosing a treatment never issues a script', () => {
  it('a selection after approval records a preference but does NOT advance the journey', async () => {
    const { accountId, corePatientId } = await approvedMenopausePatient();
    expect((await getJourney(admin, accountId))?.state).toBe('approved');

    const result = await submitMenopauseTreatment(
      admin,
      core,
      RX_ON,
      accountId,
      corePatientId,
      cleanAnswers({ selectedProductId: 'estradiol-patch' }),
    );

    // The preference was recorded to the CORE (Article 9), not the app DB.
    expect(result.decision.outcome).toBe('proceed');
    expect(result.decision.selectedProductId).toBe('estradiol-patch');
    expect(result.intakeId).toBeTruthy();
    const intake = await core.getIntake(result.intakeId!);
    expect(intake?.payload.condition).toBe('menopause_treatment');
    expect(intake?.payload.treatmentSelection).toBe('estradiol-patch');

    // THE HARD LINE: the journey did NOT move. Selecting is a preference, not a
    // prescription. The patient is still at 'approved'; only a clinician action
    // reaches rx_issued from there.
    expect(result.stateBefore).toBe('approved');
    expect(result.stateAfter).toBe('approved');
    expect((await getJourney(admin, accountId))?.state).toBe('approved');

    // rx_issued's predecessors are unchanged; no new path reaches it.
    expect([...RX_ISSUED_PREDECESSORS].sort()).toEqual(['approved', 'consult_done']);
    expect(canTransition('approved', 'rx_issued')).toBe(true); // clinician-only
    expect(canTransition('screening_kit_sent', 'rx_issued')).toBe(false);
  });
});
