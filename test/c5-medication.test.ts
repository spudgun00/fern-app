import { afterAll, describe, expect, it } from 'vitest';
import { readEnv } from '../src/lib/env';
import { createAdminClient } from '../src/lib/supabase/admin';
import { MockCore } from '../src/lib/adapters/mock-core';
import { MockDispensing } from '../src/lib/adapters/mock-dispensing';
import { MockPayments } from '../src/lib/adapters/mock-payments';
import { submitIntake } from '../src/lib/intake/submit';
import { decideClinicianAction } from '../src/lib/clinician/decide';
import { startCheckout, getOrCreateCustomer } from '../src/lib/payments/billing';
import { startProductCheckout } from '../src/lib/checkout/checkout';
import { getProduct, PRODUCTS } from '../src/lib/checkout/products';
import {
  advanceOnMedicationPaid,
  finaliseMedicationCheckout,
  dispensingAwaitsMedicationPayment,
  medicationBillingFromEnv,
  medicationProductIdForDoor,
} from '../src/lib/medication/medication';
import { finaliseAddonCheckout } from '../src/lib/addons/addons';
import { canTransition, RX_ISSUED_PREDECESSORS } from '../src/lib/journey/machine';
import type { IntakeAnswers } from '../src/lib/intake/routing';
import {
  ensureAccount,
  getJourney,
  getLatestPaymentRef,
  getPaymentsCustomerRef,
  setCorePatientId,
  setJourney,
  upsertMembership,
} from '../src/lib/accounts';

// ===========================================================================
// Checkout C5 — medication payment (Journey F) + add-ons (Journey G). Stripe test
// mode via MockPayments, keyless, proven by mock like every prior money phase.
//
// THE HARD LINE proven here: paying for medication NEVER reaches rx_issued. The
// script ALREADY exists from the clinician action (decideClinicianAction); the
// medication charge only advances rx_issued -> dispensing (it pays for dispensing).
// The add-ons touch NO clinical state at all. RX_ISSUED_PREDECESSORS is unchanged.
// ===========================================================================

const env = {
  ...readEnv(),
  CORE_IMPL: 'mock',
  DISPENSING_IMPL: 'mock',
  PAYMENTS_IMPL: 'mock',
};
const admin = createAdminClient(env);
const core = new MockCore(admin);
const dispensing = new MockDispensing(admin);
const payments = new MockPayments(admin);
const createdAccounts: string[] = [];
const createdPatients: string[] = [];

afterAll(async () => {
  if (createdAccounts.length > 0) {
    await admin.from('mock_payment_session').delete().in('account_id', createdAccounts);
    // Account delete cascades journey / queue_item / payment_ref / membership /
    // checkout_consent / payments_customer.
    await admin.from('account').delete().in('id', createdAccounts);
  }
  if (createdPatients.length > 0) {
    await admin.from('mock_core_intake').delete().in('core_patient_id', createdPatients);
    await admin.from('mock_core_prescription').delete().in('core_patient_id', createdPatients);
    await admin.from('mock_core_consult_note').delete().in('core_patient_id', createdPatients);
    await admin.from('mock_core_patient').delete().in('id', createdPatients);
  }
});

function fastLaneAnswers(): IntakeAnswers {
  return {
    treatmentHistory: 'continuing',
    symptoms: ['hot_flushes', 'night_sweats'],
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

async function freshClinician(): Promise<string> {
  const account = await ensureAccount(admin, crypto.randomUUID());
  createdAccounts.push(account.id);
  await admin.from('account').update({ role: 'clinician' }).eq('id', account.id);
  return account.id;
}

function sessionIdFromClientUrl(clientUrl: string): string {
  return new URL(clientUrl, 'https://x').searchParams.get('session')!;
}

// A patient whom a CLINICIAN has approved: the journey sits at rx_issued and a
// script exists in the core — but it has NOT been dispensed (Journey F defers
// dispensing to the medication payment). This is the precondition the medication
// gate builds on: rx_issued is reached by the clinician, never by a payment.
async function patientAtRxIssued(): Promise<{
  accountId: string;
  corePatientId: string;
  rxId: string;
}> {
  const clinicianId = await freshClinician();
  const account = await ensureAccount(admin, crypto.randomUUID());
  createdAccounts.push(account.id);
  const corePatientId = await core.createPatient({ fullName: 'C5 Patient' });
  createdPatients.push(corePatientId);
  await setCorePatientId(admin, account.id, corePatientId);
  await setJourney(admin, account.id, 'id_verified', null);
  await submitIntake(admin, core, account.id, corePatientId, 'menopause', fastLaneAnswers());
  const { data } = await admin.from('queue_item').select('*').eq('account_id', account.id).single();
  const decision = await decideClinicianAction(admin, core, {
    clinicianAccountId: clinicianId,
    queueItemId: data.id,
    action: 'approve',
    reason: 'Clear continuing picture.',
    rxItems: [{ name: 'Transdermal HRT', dose: 'as directed', quantity: 1 }],
  });
  // The clinician action — not a payment — reached rx_issued.
  expect(decision.newState).toBe('rx_issued');
  return { accountId: account.id, corePatientId, rxId: decision.rxId! };
}

async function payMedication(accountId: string): Promise<string> {
  const clientUrl = await startProductCheckout(
    admin,
    payments,
    PRODUCTS.menopause_medication,
    accountId,
    '/checkout/complete?product=menopause_medication',
  );
  const sessionId = sessionIdFromClientUrl(clientUrl);
  await payments.markPaid(sessionId);
  return sessionId;
}

// ---------------------------------------------------------------------------
// Journey F: paying for medication advances rx_issued -> dispensing, and the
// payment NEVER reaches rx_issued (the script pre-exists from the clinician).
// ---------------------------------------------------------------------------
describe('C5 Journey F: medication payment gates dispensing, never rx_issued', () => {
  it('pay medication (per_fill) -> dispensing; rx_issued pre-existed via the clinician', { timeout: 60_000 }, async () => {
    const { accountId, corePatientId } = await patientAtRxIssued();
    // rx_issued was reached by the clinician; there is NO medication payment yet.
    expect((await getJourney(admin, accountId))?.state).toBe('rx_issued');
    expect(await getLatestPaymentRef(admin, accountId, 'medication')).toBeNull();

    await payMedication(accountId);
    const gate = await finaliseMedicationCheckout(
      admin,
      payments,
      core,
      dispensing,
      accountId,
      corePatientId,
      'per_fill',
    );

    // The medication charge advanced ONLY rx_issued -> dispensing.
    expect(gate.covered).toBe(true);
    expect(gate.advancedToDispensing).toBe(true);
    expect(gate.state).toBe('dispensing');
    expect((await getJourney(admin, accountId))?.state).toBe('dispensing');
    expect((await getLatestPaymentRef(admin, accountId, 'medication'))?.status).toBe('paid');

    // THE HARD LINE: the payment never created rx_issued (it was a precondition),
    // and the predecessors are unchanged. Only a clinician reaches rx_issued.
    expect([...RX_ISSUED_PREDECESSORS].sort()).toEqual(['approved', 'consult_done']);
    expect(canTransition('approved', 'rx_issued')).toBe(true); // clinician-only
    expect(canTransition('dispensing', 'rx_issued')).toBe(false);
  });

  it('the gate is a no-op unless the patient is at rx_issued (before the clinician)', { timeout: 60_000 }, async () => {
    // A patient who has NOT been approved (still at id_verified). Even a paid
    // medication payment cannot dispense — there is no issued script.
    const account = await ensureAccount(admin, crypto.randomUUID());
    createdAccounts.push(account.id);
    const corePatientId = await core.createPatient({ fullName: 'C5 Not Approved' });
    createdPatients.push(corePatientId);
    await setCorePatientId(admin, account.id, corePatientId);
    await setJourney(admin, account.id, 'id_verified', null);

    await payMedication(account.id);
    const gate = await advanceOnMedicationPaid(admin, core, dispensing, account.id, corePatientId, 'per_fill');
    expect(gate.advancedToDispensing).toBe(false);
    expect((await getJourney(admin, account.id))?.state).toBe('id_verified');
  });
});

// ---------------------------------------------------------------------------
// Open decision #4: per-fill vs bundled toggles cleanly, both from rx_issued.
// ---------------------------------------------------------------------------
describe('C5 medication billing (open decision #4) toggles cleanly', () => {
  it('per_fill: no dispense until medication is paid; then it dispenses', { timeout: 60_000 }, async () => {
    const { accountId, corePatientId } = await patientAtRxIssued();

    // Unpaid -> the gate is a no-op; the patient waits at rx_issued.
    const before = await advanceOnMedicationPaid(admin, core, dispensing, accountId, corePatientId, 'per_fill');
    expect(before.covered).toBe(false);
    expect(before.advancedToDispensing).toBe(false);
    expect((await getJourney(admin, accountId))?.state).toBe('rx_issued');

    // Paid -> finalise (flips the pending pointer to paid on the live provider
    // status) and the gate dispenses.
    await payMedication(accountId);
    const after = await finaliseMedicationCheckout(admin, payments, core, dispensing, accountId, corePatientId, 'per_fill');
    expect(after.advancedToDispensing).toBe(true);
    expect((await getJourney(admin, accountId))?.state).toBe('dispensing');
  });

  it('bundled: an active member dispenses with NO separate charge; a non-member does not', { timeout: 60_000 }, async () => {
    // Non-member, bundled -> no coverage, no dispense (no membership, no charge).
    const nonMember = await patientAtRxIssued();
    const gateNon = await advanceOnMedicationPaid(admin, core, dispensing, nonMember.accountId, nonMember.corePatientId, 'bundled');
    expect(gateNon.covered).toBe(false);
    expect(gateNon.advancedToDispensing).toBe(false);
    expect((await getJourney(admin, nonMember.accountId))?.state).toBe('rx_issued');
    // And no medication payment was raised for the bundled member path.
    expect(await getLatestPaymentRef(admin, nonMember.accountId, 'medication')).toBeNull();

    // Active member, bundled -> covered by membership, dispenses with no charge.
    const member = await patientAtRxIssued();
    await upsertMembership(admin, member.accountId, {
      status: 'active',
      providerCustomerRef: 'mock_cus_bundled',
      providerSubscriptionRef: 'mock_sub_bundled',
    });
    const gateMember = await advanceOnMedicationPaid(admin, core, dispensing, member.accountId, member.corePatientId, 'bundled');
    expect(gateMember.covered).toBe(true);
    expect(gateMember.advancedToDispensing).toBe(true);
    expect((await getJourney(admin, member.accountId))?.state).toBe('dispensing');
    // Bundled: covered by membership, so NO separate medication charge exists.
    expect(await getLatestPaymentRef(admin, member.accountId, 'medication')).toBeNull();
  });

  it('dispensingAwaitsMedicationPayment: only per_fill inside the purchase funnel defers', () => {
    expect(dispensingAwaitsMedicationPayment({ purchaseEnabled: true }, 'per_fill')).toBe(true);
    expect(dispensingAwaitsMedicationPayment({ purchaseEnabled: true }, 'bundled')).toBe(false);
    expect(dispensingAwaitsMedicationPayment({ purchaseEnabled: false }, 'per_fill')).toBe(false);
    expect(medicationBillingFromEnv({ MEDICATION_BILLING: 'per_fill' })).toBe('per_fill');
    expect(medicationBillingFromEnv({ MEDICATION_BILLING: 'bundled' })).toBe('bundled');
    expect(medicationProductIdForDoor('menopause')).toBe('menopause_medication');
    expect(medicationProductIdForDoor('weight')).toBe('weight_medication');
  });
});

// ---------------------------------------------------------------------------
// One Stripe customer per patient: the medication charge attaches to the SAME
// customer as the patient's earlier purchases (the C4 ensureCustomer path).
// ---------------------------------------------------------------------------
describe('C5 one customer per patient: medication rides the same customer', () => {
  it('a prior consult charge and a later medication charge share one customer', { timeout: 60_000 }, async () => {
    const { accountId } = await patientAtRxIssued();

    // A prior one-off (consult) creates + stores the single customer.
    await startCheckout(admin, payments, 'consult', accountId, '/r');
    const customer = await getPaymentsCustomerRef(admin, accountId);
    expect(customer).toBeTruthy();

    // The medication checkout rides the SAME customer (no second customer minted).
    const medSession = await payMedication(accountId);
    const { data: medRow } = await admin
      .from('mock_payment_session')
      .select('customer_ref')
      .eq('id', medSession)
      .single();
    expect(medRow!.customer_ref).toBe(customer);
    expect(await getPaymentsCustomerRef(admin, accountId)).toBe(customer);
    // getOrCreateCustomer stays idempotent.
    expect(await getOrCreateCustomer(admin, payments, accountId)).toBe(customer);
  });
});

// ---------------------------------------------------------------------------
// Journey G: the add-ons record a fulfilment / recurring line and touch NO
// clinical state (no journey change, no script, no dispense path).
// ---------------------------------------------------------------------------
describe('C5 Journey G: add-ons record a line, touch no clinical state', () => {
  it('side-effect kit (one-off): fulfilment line recorded, journey unchanged', { timeout: 60_000 }, async () => {
    const { accountId, corePatientId } = await patientAtRxIssued();
    const stateBefore = (await getJourney(admin, accountId))?.state;
    const scriptsBefore = (await core.getPrescriptions(corePatientId)).length;

    const clientUrl = await startProductCheckout(admin, payments, PRODUCTS.addon_kit, accountId, '/r');
    await payments.markPaid(sessionIdFromClientUrl(clientUrl));
    const result = await finaliseAddonCheckout(admin, payments, accountId, 'addon_kit');

    expect(result.paid).toBe(true);
    expect((await getLatestPaymentRef(admin, accountId, 'addon_kit'))?.status).toBe('paid');
    // No clinical state touched: same journey state, same number of scripts.
    expect((await getJourney(admin, accountId))?.state).toBe(stateBefore);
    expect((await core.getPrescriptions(corePatientId)).length).toBe(scriptsBefore);
  });

  it('re-screen (recurring): a recurring screen charge with no script path', { timeout: 60_000 }, async () => {
    const { accountId, corePatientId } = await patientAtRxIssued();
    const stateBefore = (await getJourney(admin, accountId))?.state;
    const scriptsBefore = (await core.getPrescriptions(corePatientId)).length;

    const clientUrl = await startProductCheckout(admin, payments, PRODUCTS.rescreen, accountId, '/r');
    await payments.markPaid(sessionIdFromClientUrl(clientUrl));
    const result = await finaliseAddonCheckout(admin, payments, accountId, 'rescreen');

    expect(result.paid).toBe(true);
    expect((await getLatestPaymentRef(admin, accountId, 'rescreen'))?.status).toBe('paid');
    // No script path: journey unchanged, no new prescription.
    expect((await getJourney(admin, accountId))?.state).toBe(stateBefore);
    expect((await core.getPrescriptions(corePatientId)).length).toBe(scriptsBefore);
    // The descriptor carries the recurring cadence note.
    expect(PRODUCTS.rescreen.recurringNote).toMatch(/6 to 12 months/i);
  });
});

// ---------------------------------------------------------------------------
// Copy discipline + flag gating (render-data proof, no dist grep): no descriptor
// names a medicine or says "free"; medication resolves ONLY behind its Rx flag.
// ---------------------------------------------------------------------------
describe('C5 copy discipline + flag gating', () => {
  const DRUG_TERMS =
    /mounjaro|wegovy|ozempic|semaglutide|tirzepatide|glp-?1|estradiol|oestrogen|progest|\bhrt\b|testosterone|injection|inject|\bjab\b|\bpen\b/i;

  it('no C5 descriptor names a medicine or says "free"', () => {
    for (const id of ['menopause_medication', 'weight_medication', 'addon_kit', 'rescreen'] as const) {
      const blob = JSON.stringify(PRODUCTS[id]).toLowerCase();
      expect(blob, `${id} contains a drug-adjacent term`).not.toMatch(DRUG_TERMS);
      expect(blob, `${id} says "free"`).not.toContain('free');
    }
  });

  it('menopause_medication resolves ONLY when menopauseRx is on', () => {
    expect(getProduct('menopause_medication', { weightLossRx: false })).toBeNull();
    expect(getProduct('menopause_medication', { weightLossRx: false, menopauseRx: false })).toBeNull();
    expect(getProduct('menopause_medication', { weightLossRx: false, menopauseRx: true })?.id).toBe(
      'menopause_medication',
    );
  });

  it('weight_medication resolves ONLY when weightLossRx is on', () => {
    expect(getProduct('weight_medication', { weightLossRx: false })).toBeNull();
    expect(getProduct('weight_medication', { weightLossRx: true })?.id).toBe('weight_medication');
  });

  it('the ungated add-ons resolve regardless of the Rx flags (they name no medicine)', () => {
    expect(getProduct('addon_kit', { weightLossRx: false, menopauseRx: false })?.id).toBe('addon_kit');
    expect(getProduct('rescreen', { weightLossRx: false, menopauseRx: false })?.id).toBe('rescreen');
  });

  it('the hard line is intact: rx_issued predecessors unchanged', () => {
    expect([...RX_ISSUED_PREDECESSORS].sort()).toEqual(['approved', 'consult_done']);
  });
});
