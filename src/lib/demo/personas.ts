import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppEnv } from '../env';
import { getClinicalCore, getIdentity } from '../adapters/factory';
import { MockIdentity } from '../adapters/mock-identity';
import {
  ensureAccount,
  recordGpSharing,
  recordIdVerification,
  setCorePatientId,
  setJourney,
  upsertMembership,
  type Account,
} from '../accounts';
import { finaliseVerification } from '../verification';
import { submitIntake } from '../intake/submit';
import type { IntakeAnswers } from '../intake/routing';
import { transition } from '../journey/machine';

// ===========================================================================
// D4 — demo personas + the self-walkable path switcher.
//
// Each persona resets the logged-in account to a clean slate, then seeds dummy
// data through the SAME adapters + journey machine the app uses, landing the
// account at the actionable point of one deliberate happy or sad path. The
// reviewer then walks it to its terminal state on the real, styled surfaces,
// without knowing any seed.
//
// HARD LINE (carried, in code): a persona drives the patient TO a clinician
// decision; it NEVER auto-issues a script. No seeder calls issuePrescription /
// reaches rx_issued. The clinician action (or the clearly-fenced dev step) still
// takes every prescribing decision. The fast-lane personas land in the review
// queue; the full-lane persona lands at the consult pay-gate; the membership
// persona seeds a billing position only (no script, no rx). A test asserts no
// persona seed reaches a prescribing state.
//
// CLEANUP (D4): the demo touches ONLY the throwaway, namespaced mock_* tables
// and the per-account app-DB pointer rows. resetAndSweep() clears both for one
// account on every persona run (so no stale mock_* leaks into the next walk);
// purgeAllDemoData() wipes the mock_* tables globally for a fresh handover.
// Neither touches Supabase auth users — that is a separate, supervised, manual
// task by design.
// ===========================================================================

export type DemoRole = 'patient' | 'clinician';

export interface Persona {
  id: string;
  /** The dummy patient's name (seeded into the mock core profile). */
  name: string;
  /** Short path title shown on the panel card. */
  title: string;
  /** One line describing the path this persona walks. */
  summary: string;
  /** What the reviewer does, in plain steps. */
  walk: string;
  /** The role the reviewer lands in (the role the next action needs). */
  role: DemoRole;
  /** The URL the reviewer lands on after the persona is applied. */
  landing: string;
  /** True when the path is terminal on landing (no reviewer action follows). */
  terminal?: boolean;
}

// The six curated paths (the spec's named outcomes). Fast-approve, escalate and
// refuse share a fast-lane review-queue seed and differ only in the clinician
// action the reviewer takes; full-consult, red-flag and cancel each seed their
// own distinct position.
export const PERSONAS: Persona[] = [
  {
    id: 'fast-approve',
    name: 'Maria Whitfield',
    title: 'Fast lane — approve',
    summary:
      'Continuing HRT with a clear, low-risk picture. Routes to the clinician review queue.',
    walk:
      'As the clinician: open the queue, open the intake, then Approve and issue. Switch to patient to see the script reach the pharmacy.',
    role: 'clinician',
    landing: '/clinician',
  },
  {
    id: 'full-consult',
    name: 'Priya Anand',
    title: 'Full lane — consult and issue',
    summary:
      'Starting HRT for the first time. Routes to the assessed lane and the consult pay-gate.',
    walk:
      'As the patient: pay the consult fee (mock checkout), book a slot (mock), join the room. Switch to clinician to issue at the consult.',
    role: 'patient',
    landing: '/consult',
  },
  {
    id: 'red-flag',
    name: 'Susan Pryce',
    title: 'Red flag — stop and signpost',
    summary:
      'Reports unexplained bleeding. The service stops and signposts to a GP; no lane is assigned.',
    walk:
      'As the patient: read the stop signpost on the intake outcome. This path is terminal by design.',
    role: 'patient',
    landing: '/intake',
    terminal: true,
  },
  {
    id: 'escalate',
    name: 'Joanne Beck',
    title: 'Fast lane — escalate to a consult',
    summary:
      'In the review queue, but the clinician wants an assessed consult. Escalating moves her to the full lane.',
    walk:
      'As the clinician: open the intake and Escalate. Switch to patient to pay and book, then back to clinician to issue at the consult.',
    role: 'clinician',
    landing: '/clinician',
  },
  {
    id: 'refuse',
    name: 'Helen Marsh',
    title: 'Fast lane — refuse and signpost',
    summary:
      'In the review queue. The clinician cannot proceed and refuses with a recorded reason and a signpost.',
    walk:
      'As the clinician: open the intake and Refuse with a reason. Switch to patient to see the signpost. Terminal.',
    role: 'clinician',
    landing: '/clinician',
  },
  {
    id: 'cancel',
    name: 'Anne Holloway',
    title: 'Member — cancel membership',
    summary:
      'An active member. Cancelling in the billing portal pulls the no-charge repeat benefit.',
    walk:
      'As the patient: open billing, manage in the portal, then cancel. The membership flips to cancelled.',
    role: 'patient',
    landing: '/account/billing',
  },
];

export function getPersona(id: string): Persona | undefined {
  return PERSONAS.find((p) => p.id === id);
}

// The throwaway, namespaced mock_* tables: the ONLY place mock clinical-shaped
// dummy data sits. The demo cleanup (per-account sweep + global purge) touches
// THESE AND ONLY THESE — never auth users, never anything outside this list.
export const MOCK_TABLES = [
  'mock_core_patient',
  'mock_core_intake',
  'mock_core_consult_note',
  'mock_core_prescription',
  'mock_core_repeat_request',
  'mock_dispense',
  'mock_identity_verification',
  'mock_payment_session',
  'mock_booking_session',
] as const;

// ---------------------------------------------------------------------------
// Intake answer sets. Clinical-shaped dummy data that drives routeIntake to a
// known lane. The structured answers ride into the mock core; only the pointer +
// outcome land in the app DB, exactly as a real submission.
// ---------------------------------------------------------------------------
function cleanScreen(): Omit<IntakeAnswers, 'treatmentHistory' | 'unexplainedBleeding'> {
  return {
    symptoms: ['hot_flushes', 'night_sweats'],
    monthsSinceLastPeriod: 18,
    bpSystolic: 124,
    bpDiastolic: 78,
    clotHistory: false,
    breastCancerHistory: false,
    liverDisease: false,
    currentPregnancy: false,
    suspectedClotSymptoms: false,
    undiagnosedBreastLump: false,
  };
}

// Continuing + clean, no flags -> the FAST (async review) lane.
function answersFast(): IntakeAnswers {
  return { treatmentHistory: 'continuing', unexplainedBleeding: false, ...cleanScreen() };
}

// First-time initiation, otherwise clean -> the FULL (assessed) lane.
function answersFull(): IntakeAnswers {
  return { treatmentHistory: 'initiation', unexplainedBleeding: false, ...cleanScreen() };
}

// A hard red flag -> STOP + signpost, no lane (red flags take precedence).
function answersRedFlag(): IntakeAnswers {
  return { treatmentHistory: 'continuing', unexplainedBleeding: true, ...cleanScreen() };
}

// ---------------------------------------------------------------------------
// Seeders.
// ---------------------------------------------------------------------------

// Reset ONE account to a clean slate AND sweep the throwaway mock_* clinical
// data tied to it, so re-running a persona never leaks stale rows into the next
// walk (the D4 cleanup). mock_* first (it is keyed via the app-DB pointers we are
// about to drop), then the app-DB pointer rows, then the journey reset.
export async function resetAndSweep(admin: SupabaseClient, account: Account): Promise<void> {
  // 1. Sweep this account's mock_* clinical data (per-account, mock_* only).
  const cpid = account.core_patient_id;
  if (cpid) {
    await admin.from('mock_core_intake').delete().eq('core_patient_id', cpid);
    await admin.from('mock_core_consult_note').delete().eq('core_patient_id', cpid);
    await admin.from('mock_core_prescription').delete().eq('core_patient_id', cpid);
    await admin.from('mock_core_repeat_request').delete().eq('core_patient_id', cpid);
    await admin.from('mock_core_patient').delete().eq('id', cpid);
  }
  // mock_dispense is keyed by its own id; map via the app-DB dispense_ref pointers
  // before they are cleared below.
  const { data: dispenseRows } = await admin
    .from('dispense_ref')
    .select('dispense_id')
    .eq('account_id', account.id);
  const dispenseIds = (dispenseRows ?? []).map((r) => r.dispense_id).filter(Boolean);
  if (dispenseIds.length > 0) {
    await admin.from('mock_dispense').delete().in('id', dispenseIds);
  }
  await admin.from('mock_identity_verification').delete().eq('account_id', account.id);
  await admin.from('mock_payment_session').delete().eq('account_id', account.id);
  await admin.from('mock_booking_session').delete().eq('account_id', account.id);

  // 2. Clear this account's app-DB pointer rows (pointers + status only).
  await admin.from('queue_item').delete().eq('account_id', account.id);
  await admin.from('intake_ref').delete().eq('account_id', account.id);
  await admin.from('id_verification').delete().eq('account_id', account.id);
  await admin.from('gp_sharing').delete().eq('account_id', account.id);
  await admin.from('dispense_ref').delete().eq('account_id', account.id);
  await admin.from('payment_ref').delete().eq('account_id', account.id);
  await admin.from('booking_ref').delete().eq('account_id', account.id);
  await admin.from('membership').delete().eq('account_id', account.id);

  // 3. Reset the account itself: clear the core mapping, journey back to start.
  await setCorePatientId(admin, account.id, null);
  await setJourney(admin, account.id, 'registered', null);
}

// Seed the shared onboarding tail (registered -> id_verified) through the real
// adapters: a mock core patient mapped onto the account, a GP-sharing consent,
// and an ID-verification round-trip completed via the mock provider affordance.
async function seedOnboarding(
  env: AppEnv,
  admin: SupabaseClient,
  account: Account,
  profile: { fullName: string; email?: string },
): Promise<string> {
  const core = getClinicalCore(env, admin);
  const corePatientId = await core.createPatient({
    fullName: profile.fullName,
    email: profile.email,
  });
  await setCorePatientId(admin, account.id, corePatientId);
  await recordGpSharing(admin, account.id, 'consent', null);

  const identity = getIdentity(env, admin);
  await setJourney(admin, account.id, transition('registered', 'id_pending'), null);
  const session = await identity.createVerificationSession(account.id, '/account/verify/complete');
  await recordIdVerification(admin, account.id, session.sessionId, 'requires_input');
  // The mock provider completes server-side (the real Stripe path is completed by
  // the user in the browser; D4 runs on the mock by design).
  if (identity instanceof MockIdentity) {
    await identity.markVerified(session.sessionId);
  }
  const liveStatus = await identity.getVerificationStatus(session.sessionId);
  await finaliseVerification(admin, account.id, session.sessionId, liveStatus);

  return corePatientId;
}

// Seed an intake through the SAME submit path the app uses: routeIntake decides
// the lane, the answers go to the core, the journey advances, the pointer is
// recorded. Stops where a real submission stops (fast -> in_review_queue, full ->
// intake_submitted, stop -> intake_submitted, no lane). No prescribing.
async function seedIntake(
  env: AppEnv,
  admin: SupabaseClient,
  account: Account,
  corePatientId: string,
  answers: IntakeAnswers,
): Promise<void> {
  const core = getClinicalCore(env, admin);
  await submitIntake(admin, core, account.id, corePatientId, 'menopause', answers);
}

// Seed an active member for the membership-cancel walk. This seeds a billing
// POSITION + an active membership pointer ONLY: it never issues a script, never
// mints an rx, never reaches a prescribing state (the hard line). The journey is
// placed at active_member via the raw setter (a deliberate, fenced demo seed for
// a billing-only path); /account/billing reads membership.status === 'active'.
async function seedActiveMember(admin: SupabaseClient, account: Account): Promise<void> {
  await upsertMembership(admin, account.id, {
    status: 'active',
    providerCustomerRef: `mock_cus_demo_${crypto.randomUUID()}`,
    providerSubscriptionRef: `mock_sub_demo_${crypto.randomUUID()}`,
  });
  await setJourney(admin, account.id, 'active_member', null);
}

export interface AppliedPersona {
  account: Account;
  persona: Persona;
  landing: string;
  role: DemoRole;
}

// Apply a persona to the logged-in account: reset + sweep, seed the path, set the
// landing role. Returns where to send the reviewer.
export async function applyPersona(
  env: AppEnv,
  admin: SupabaseClient,
  authUserId: string,
  personaId: string,
  email?: string,
): Promise<AppliedPersona> {
  const persona = getPersona(personaId);
  if (!persona) throw new Error(`applyPersona: unknown persona ${personaId}`);

  const account = await ensureAccount(admin, authUserId);
  await resetAndSweep(admin, account);

  if (persona.id === 'cancel') {
    await seedOnboarding(env, admin, account, { fullName: persona.name, email });
    await seedActiveMember(admin, account);
  } else {
    const corePatientId = await seedOnboarding(env, admin, account, {
      fullName: persona.name,
      email,
    });
    const answers =
      persona.id === 'full-consult'
        ? answersFull()
        : persona.id === 'red-flag'
          ? answersRedFlag()
          : answersFast(); // fast-approve | escalate | refuse
    await seedIntake(env, admin, account, corePatientId, answers);
  }

  // Set the role the landing action needs (patient seeds the data; the clinician
  // landings flip to clinician so the queue is actionable on the same account).
  await setRole(admin, account.id, persona.role);

  return { account, persona, landing: persona.landing, role: persona.role };
}

// Flip the logged-in account's role (the demo role switch). The same affordance
// the dev harness uses, scoped to the demo panel.
export async function setRole(
  admin: SupabaseClient,
  accountId: string,
  role: DemoRole,
): Promise<void> {
  const { error } = await admin.from('account').update({ role }).eq('id', accountId);
  if (error) throw new Error(`setRole: ${error.message}`);
}

// Global purge for a fresh handover: wipe EVERY mock_* row across all accounts.
// Touches ONLY the throwaway namespaced tables (the boundary the whole build has
// held) — never auth users, never app-DB account/journey rows. The next persona
// run resets the active account's app-DB pointers, so dangling pointers are
// harmless. Destructive and demo-only; the panel fences it behind a confirm.
export async function purgeAllDemoData(admin: SupabaseClient): Promise<void> {
  for (const table of MOCK_TABLES) {
    const { error } = await admin.from(table).delete().not('id', 'is', null);
    if (error) throw new Error(`purgeAllDemoData(${table}): ${error.message}`);
  }
}
