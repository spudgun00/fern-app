import type { SupabaseClient } from '@supabase/supabase-js';
import { transition } from './journey/machine';
import type { JourneyState, Lane } from './journey/states';
import type { IntakeOutcome } from './intake/routing';

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

export async function getAccountById(
  db: SupabaseClient,
  accountId: string,
): Promise<Account | null> {
  const { data, error } = await db
    .from('account')
    .select('*')
    .eq('id', accountId)
    .maybeSingle();
  if (error) throw new Error(`getAccountById: ${error.message}`);
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

// Reads the current journey, applies the legal transition (throws on an illegal
// one), and persists it. The single place P1 routes change journey state.
export async function advanceJourney(
  db: SupabaseClient,
  accountId: string,
  to: JourneyState,
  lane: Lane | null = null,
): Promise<JourneyState> {
  const journey = await getJourney(db, accountId);
  if (!journey) throw new Error(`advanceJourney: no journey for account ${accountId}`);
  const next = transition(journey.state, to); // throws IllegalTransitionError if illegal
  await setJourney(db, accountId, next, lane ?? journey.lane);
  return next;
}

// ---------------------------------------------------------------------------
// GP info-sharing consent (HARD LINE): a patient either consents to GP sharing
// or makes an explicit refusal that MUST carry a recorded risk note. This is
// administrative consent state, not Article 9 clinical content (P1 captures no
// clinical data), so it lives in the app DB.
// ---------------------------------------------------------------------------
export type GpSharingDecision = 'consent' | 'refused';

export interface GpSharing {
  id: string;
  account_id: string;
  decision: GpSharingDecision;
  risk_note: string | null;
  recorded_at: string;
}

export async function recordGpSharing(
  db: SupabaseClient,
  accountId: string,
  decision: GpSharingDecision,
  riskNote: string | null,
): Promise<void> {
  const note = (riskNote ?? '').trim();
  if (decision === 'refused' && note === '') {
    // Enforced server-side, not only in the form: a refusal without a recorded
    // risk note is rejected (hard line).
    throw new Error('recordGpSharing: a GP-sharing refusal requires a recorded risk note');
  }
  const { error } = await db.from('gp_sharing').insert({
    account_id: accountId,
    decision,
    risk_note: decision === 'refused' ? note : null,
  });
  if (error) throw new Error(`recordGpSharing: ${error.message}`);
}

export async function getGpSharing(
  db: SupabaseClient,
  accountId: string,
): Promise<GpSharing | null> {
  const { data, error } = await db
    .from('gp_sharing')
    .select('*')
    .eq('account_id', accountId)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getGpSharing: ${error.message}`);
  return (data as GpSharing) ?? null;
}

// ---------------------------------------------------------------------------
// ID verification (HARD LINE): the app DB stores only the provider session
// pointer (provider_ref) and a coarse status. NO document images, NO extracted
// ID PII (name / DOB / selfie) ever land here; that data stays with the
// provider behind the IdentityAdapter.
// ---------------------------------------------------------------------------
export interface IdVerification {
  id: string;
  account_id: string;
  provider_ref: string;
  status: string;
  created_at: string;
}

export async function recordIdVerification(
  db: SupabaseClient,
  accountId: string,
  providerRef: string,
  status: string,
): Promise<void> {
  const { error } = await db
    .from('id_verification')
    .insert({ account_id: accountId, provider_ref: providerRef, status });
  if (error) throw new Error(`recordIdVerification: ${error.message}`);
}

export async function setIdVerificationStatus(
  db: SupabaseClient,
  providerRef: string,
  status: string,
): Promise<void> {
  const { error } = await db
    .from('id_verification')
    .update({ status })
    .eq('provider_ref', providerRef);
  if (error) throw new Error(`setIdVerificationStatus: ${error.message}`);
}

export async function getLatestIdVerification(
  db: SupabaseClient,
  accountId: string,
): Promise<IdVerification | null> {
  const { data, error } = await db
    .from('id_verification')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getLatestIdVerification: ${error.message}`);
  return (data as IdVerification) ?? null;
}

export async function getIdVerificationByRef(
  db: SupabaseClient,
  providerRef: string,
): Promise<IdVerification | null> {
  const { data, error } = await db
    .from('id_verification')
    .select('*')
    .eq('provider_ref', providerRef)
    .maybeSingle();
  if (error) throw new Error(`getIdVerificationByRef: ${error.message}`);
  return (data as IdVerification) ?? null;
}

// ---------------------------------------------------------------------------
// Intake routing pointer (P2). The app DB records ONLY a pointer to the core
// intake plus the routing OUTCOME (which lane, or a stop) and a status. The
// structured ANSWERS and the routing REASONS are Article 9 and live ONLY in the
// clinical core behind the ClinicalCoreAdapter; they are never copied here.
// ---------------------------------------------------------------------------
export interface IntakeRef {
  id: string;
  account_id: string;
  intake_id: string;
  outcome: IntakeOutcome;
  status: string;
  created_at: string;
}

export async function recordIntakeRef(
  db: SupabaseClient,
  accountId: string,
  intakeId: string,
  outcome: IntakeOutcome,
  status: string = 'submitted',
): Promise<void> {
  const { error } = await db
    .from('intake_ref')
    .insert({ account_id: accountId, intake_id: intakeId, outcome, status });
  if (error) throw new Error(`recordIntakeRef: ${error.message}`);
}

export async function getLatestIntakeRef(
  db: SupabaseClient,
  accountId: string,
): Promise<IntakeRef | null> {
  const { data, error } = await db
    .from('intake_ref')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getLatestIntakeRef: ${error.message}`);
  return (data as IntakeRef) ?? null;
}

// ---------------------------------------------------------------------------
// Review queue (P3). queue_item is a POINTER + administrative status only: which
// account, which core intake, the lane, the workflow status, and (after a
// decision) WHO decided, WHEN, and POINTERS to the core artifacts produced. The
// clinician's rationale and the issued script live ONLY in the core; only their
// pointers (note_ref / rx_ref) are recorded here. No answers, no clinical flags.
// ---------------------------------------------------------------------------
export interface QueueItem {
  id: string;
  account_id: string;
  intake_id: string;
  lane: Lane;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  note_ref: string | null;
  rx_ref: string | null;
  created_at: string;
}

// The clinician's fast-lane review queue: pending fast-lane items, oldest first
// (the spec's queue ordering). Driven by app-DB pointers; the clinical content
// for each item is read from the core for display, never copied here.
export async function listPendingFastQueue(db: SupabaseClient): Promise<QueueItem[]> {
  const { data, error } = await db
    .from('queue_item')
    .select('*')
    .eq('lane', 'fast')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`listPendingFastQueue: ${error.message}`);
  return (data as QueueItem[]) ?? [];
}

export async function getQueueItemById(
  db: SupabaseClient,
  queueItemId: string,
): Promise<QueueItem | null> {
  const { data, error } = await db
    .from('queue_item')
    .select('*')
    .eq('id', queueItemId)
    .maybeSingle();
  if (error) throw new Error(`getQueueItemById: ${error.message}`);
  return (data as QueueItem) ?? null;
}

// Inserts a pending fast-lane queue_item POINTER (the same shape submitIntake
// creates). Used by P2 intake and by P4 repeat requests so a fresh review enters
// the clinician queue. intake_id points at the core intake the review reads.
export async function insertFastQueueItem(
  db: SupabaseClient,
  accountId: string,
  intakeId: string,
): Promise<string> {
  const { data, error } = await db
    .from('queue_item')
    .insert({ account_id: accountId, intake_id: intakeId, lane: 'fast', status: 'pending' })
    .select('id')
    .single();
  if (error) throw new Error(`insertFastQueueItem: ${error.message}`);
  return data.id as string;
}

export interface QueueDecision {
  status: 'approved' | 'escalated' | 'refused';
  decidedBy: string;
  noteRef: string;
  rxRef?: string | null;
}

// Records the clinician decision against the queue_item: the workflow status,
// who decided, when, and pointers to the core note (and prescription on approve).
export async function recordQueueDecision(
  db: SupabaseClient,
  queueItemId: string,
  decision: QueueDecision,
): Promise<void> {
  const { error } = await db
    .from('queue_item')
    .update({
      status: decision.status,
      decided_by: decision.decidedBy,
      decided_at: new Date().toISOString(),
      note_ref: decision.noteRef,
      rx_ref: decision.rxRef ?? null,
    })
    .eq('id', queueItemId);
  if (error) throw new Error(`recordQueueDecision: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Dispensing pointer (P4). dispense_ref is a POINTER + coarse status only: which
// account, a pointer to the core prescription (rx_ref), a pointer into the
// dispensing provider (dispense_id), and a workflow status mirroring the journey
// (submitted -> dispatched -> delivered). The script + the pharmacy record live
// ONLY behind the DispensingAdapter / core; only their pointers are recorded
// here. No medicine names, no doses, no clinical detail.
// ---------------------------------------------------------------------------
export interface DispenseRef {
  id: string;
  account_id: string;
  rx_ref: string;
  dispense_id: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export async function recordDispenseRef(
  db: SupabaseClient,
  accountId: string,
  rxRef: string,
  dispenseId: string,
  status: string = 'submitted',
): Promise<void> {
  const { error } = await db
    .from('dispense_ref')
    .insert({ account_id: accountId, rx_ref: rxRef, dispense_id: dispenseId, status });
  if (error) throw new Error(`recordDispenseRef: ${error.message}`);
}

export async function getLatestDispenseRef(
  db: SupabaseClient,
  accountId: string,
): Promise<DispenseRef | null> {
  const { data, error } = await db
    .from('dispense_ref')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getLatestDispenseRef: ${error.message}`);
  return (data as DispenseRef) ?? null;
}

export async function setDispenseRefStatus(
  db: SupabaseClient,
  dispenseId: string,
  status: string,
): Promise<void> {
  const { error } = await db
    .from('dispense_ref')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('dispense_id', dispenseId);
  if (error) throw new Error(`setDispenseRefStatus: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Screening pointer (weight roadmap P2). screening_ref is a POINTER + coarse
// status only: which account, a pointer into the screening provider (kit_ref),
// and a workflow status mirroring the journey (kit_sent -> sample_received ->
// results_ready). The blood-test RESULTS (panel values) are Article 9 and live
// ONLY behind the ScreeningAdapter (mock_screening this phase); only the pointer
// + status are recorded here. No marker values, no ranges, no clinical detail.
// ---------------------------------------------------------------------------
export type ScreeningRefStatus = 'kit_sent' | 'sample_received' | 'results_ready';

export interface ScreeningRef {
  id: string;
  account_id: string;
  kit_ref: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export async function recordScreeningRef(
  db: SupabaseClient,
  accountId: string,
  kitRef: string,
  status: ScreeningRefStatus = 'kit_sent',
): Promise<void> {
  const { error } = await db
    .from('screening_ref')
    .insert({ account_id: accountId, kit_ref: kitRef, status });
  if (error) throw new Error(`recordScreeningRef: ${error.message}`);
}

export async function getLatestScreeningRef(
  db: SupabaseClient,
  accountId: string,
): Promise<ScreeningRef | null> {
  const { data, error } = await db
    .from('screening_ref')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getLatestScreeningRef: ${error.message}`);
  return (data as ScreeningRef) ?? null;
}

export async function setScreeningRefStatus(
  db: SupabaseClient,
  kitRef: string,
  status: ScreeningRefStatus,
): Promise<void> {
  const { error } = await db
    .from('screening_ref')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('kit_ref', kitRef);
  if (error) throw new Error(`setScreeningRefStatus: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Payment pointer (P5). payment_ref (P0 table) records ONLY a pointer into the
// payments provider (provider_ref = the Checkout session / payment id), the kind
// (consult one-off vs membership), and a coarse status. NO card data, NO PII;
// those live with the provider (Stripe) behind the PaymentsAdapter. Used here
// for the one-off consult fee; recurring membership state lives in `membership`.
// ---------------------------------------------------------------------------
export type PaymentKind = 'consult' | 'membership';

export interface PaymentRef {
  id: string;
  account_id: string;
  provider_ref: string | null;
  kind: PaymentKind;
  status: string;
  created_at: string;
}

export async function recordPaymentRef(
  db: SupabaseClient,
  accountId: string,
  kind: PaymentKind,
  providerRef: string,
  status: string = 'pending',
): Promise<void> {
  const { error } = await db
    .from('payment_ref')
    .insert({ account_id: accountId, kind, provider_ref: providerRef, status });
  if (error) throw new Error(`recordPaymentRef: ${error.message}`);
}

export async function setPaymentRefStatus(
  db: SupabaseClient,
  providerRef: string,
  status: string,
): Promise<void> {
  const { error } = await db
    .from('payment_ref')
    .update({ status })
    .eq('provider_ref', providerRef);
  if (error) throw new Error(`setPaymentRefStatus: ${error.message}`);
}

export async function getLatestPaymentRef(
  db: SupabaseClient,
  accountId: string,
  kind: PaymentKind,
): Promise<PaymentRef | null> {
  const { data, error } = await db
    .from('payment_ref')
    .select('*')
    .eq('account_id', accountId)
    .eq('kind', kind)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getLatestPaymentRef: ${error.message}`);
  return (data as PaymentRef) ?? null;
}

// The latest still-pending checkout session for an account (either kind). The
// billing return page reads this to finalise an in-flight checkout via its
// provider_ref (the session id), mirroring how the ID-verify return page reads
// the latest id_verification.
export async function getLatestPendingPaymentRef(
  db: SupabaseClient,
  accountId: string,
): Promise<PaymentRef | null> {
  const { data, error } = await db
    .from('payment_ref')
    .select('*')
    .eq('account_id', accountId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getLatestPendingPaymentRef: ${error.message}`);
  return (data as PaymentRef) ?? null;
}

// The consult-payment gate (tiering): a patient has paid the consult fee once a
// consult payment_ref is marked paid. The full-lane booking (P6) consults this;
// P5 surfaces it on the billing page and proves the gate flips on payment.
export async function hasPaidConsult(db: SupabaseClient, accountId: string): Promise<boolean> {
  const ref = await getLatestPaymentRef(db, accountId, 'consult');
  return ref?.status === 'paid';
}

// ---------------------------------------------------------------------------
// Membership pointer (P5). membership holds ONLY the provider customer +
// subscription pointers and a coarse billing status (inactive | active |
// canceled). NO card data, NO PII. status === 'active' is what drives member
// access (the no-charge repeat tiering) and the delivered -> active_member
// journey transition.
// ---------------------------------------------------------------------------
export type MembershipStatus = 'inactive' | 'active' | 'canceled';

export interface Membership {
  id: string;
  account_id: string;
  provider_customer_ref: string | null;
  provider_subscription_ref: string | null;
  status: MembershipStatus;
  created_at: string;
  updated_at: string;
}

export async function getMembership(
  db: SupabaseClient,
  accountId: string,
): Promise<Membership | null> {
  const { data, error } = await db
    .from('membership')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw new Error(`getMembership: ${error.message}`);
  return (data as Membership) ?? null;
}

// Upserts the single membership row for an account (one subscription state per
// account). Pointers + status only.
export async function upsertMembership(
  db: SupabaseClient,
  accountId: string,
  fields: {
    status: MembershipStatus;
    providerCustomerRef?: string | null;
    providerSubscriptionRef?: string | null;
  },
): Promise<void> {
  const row: Record<string, unknown> = {
    account_id: accountId,
    status: fields.status,
    updated_at: new Date().toISOString(),
  };
  if (fields.providerCustomerRef !== undefined) row.provider_customer_ref = fields.providerCustomerRef;
  if (fields.providerSubscriptionRef !== undefined)
    row.provider_subscription_ref = fields.providerSubscriptionRef;
  const { error } = await db.from('membership').upsert(row, { onConflict: 'account_id' });
  if (error) throw new Error(`upsertMembership: ${error.message}`);
}

// Flips membership status by provider customer ref (the cancel webhook / portal
// path maps a Stripe customer to its account this way).
export async function setMembershipStatusByCustomer(
  db: SupabaseClient,
  providerCustomerRef: string,
  status: MembershipStatus,
): Promise<void> {
  const { error } = await db
    .from('membership')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('provider_customer_ref', providerCustomerRef);
  if (error) throw new Error(`setMembershipStatusByCustomer: ${error.message}`);
}

export async function isActiveMember(db: SupabaseClient, accountId: string): Promise<boolean> {
  const m = await getMembership(db, accountId);
  return m?.status === 'active';
}

// ---------------------------------------------------------------------------
// Booking pointer (P6, the full lane). booking_ref (P0 table, extended in P6) is
// a POINTER + scheduling/decision status only: which account, a pointer into the
// booking provider (provider_ref = the Cal.com booking / correlation id), the
// booked slot time, a pointer to the video room (room_ref), a coarse status
// (pending -> booked -> issued | refused), and (after the consult decision) WHO
// decided, WHEN, and POINTERS to the core artifacts produced. The consult
// rationale + the issued script live ONLY in the core; the call lives ONLY with
// the video provider. No clinical detail, no card data, no PII.
// ---------------------------------------------------------------------------
export interface BookingRef {
  id: string;
  account_id: string;
  provider_ref: string | null;
  status: string;
  slot_at: string | null;
  room_ref: string | null;
  decided_by: string | null;
  decided_at: string | null;
  note_ref: string | null;
  rx_ref: string | null;
  created_at: string;
}

export async function recordBookingRef(
  db: SupabaseClient,
  accountId: string,
  providerRef: string,
  status: string = 'pending',
): Promise<string> {
  const { data, error } = await db
    .from('booking_ref')
    .insert({ account_id: accountId, provider_ref: providerRef, status })
    .select('id')
    .single();
  if (error) throw new Error(`recordBookingRef: ${error.message}`);
  return data.id as string;
}

export async function getBookingRefById(
  db: SupabaseClient,
  id: string,
): Promise<BookingRef | null> {
  const { data, error } = await db
    .from('booking_ref')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`getBookingRefById: ${error.message}`);
  return (data as BookingRef) ?? null;
}

export async function getLatestBookingRef(
  db: SupabaseClient,
  accountId: string,
): Promise<BookingRef | null> {
  const { data, error } = await db
    .from('booking_ref')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getLatestBookingRef: ${error.message}`);
  return (data as BookingRef) ?? null;
}

// The latest still-pending booking session for an account. The booking return
// page reads this to finalise an in-flight booking via its provider_ref, mirroring
// getLatestPendingPaymentRef.
export async function getLatestPendingBookingRef(
  db: SupabaseClient,
  accountId: string,
): Promise<BookingRef | null> {
  const { data, error } = await db
    .from('booking_ref')
    .select('*')
    .eq('account_id', accountId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getLatestPendingBookingRef: ${error.message}`);
  return (data as BookingRef) ?? null;
}

export async function getBookingRefByProviderRef(
  db: SupabaseClient,
  providerRef: string,
): Promise<BookingRef | null> {
  const { data, error } = await db
    .from('booking_ref')
    .select('*')
    .eq('provider_ref', providerRef)
    .maybeSingle();
  if (error) throw new Error(`getBookingRefByProviderRef: ${error.message}`);
  return (data as BookingRef) ?? null;
}

// Mark a booking confirmed: status pending -> booked, with the chosen slot and
// the created video room pointer. Pointers + scheduling only.
export async function setBookingRefBooked(
  db: SupabaseClient,
  id: string,
  slotAt: string | null,
  roomRef: string,
): Promise<void> {
  const { error } = await db
    .from('booking_ref')
    .update({ status: 'booked', slot_at: slotAt, room_ref: roomRef })
    .eq('id', id);
  if (error) throw new Error(`setBookingRefBooked: ${error.message}`);
}

// The clinician consult queue: booked consults awaiting a decision (status
// 'booked', not yet decided), oldest first. Driven by app-DB pointers; the
// clinical content for each is read from the core for display, never copied here.
export async function listPendingConsults(db: SupabaseClient): Promise<BookingRef[]> {
  const { data, error } = await db
    .from('booking_ref')
    .select('*')
    .eq('status', 'booked')
    .is('decided_at', null)
    .order('slot_at', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw new Error(`listPendingConsults: ${error.message}`);
  return (data as BookingRef[]) ?? [];
}

export interface ConsultDecision {
  status: 'issued' | 'refused';
  decidedBy: string;
  noteRef: string;
  rxRef?: string | null;
}

// Records the clinician consult decision against the booking_ref: the workflow
// status, who decided, when, and pointers to the core note (and prescription on
// issue). Mirrors recordQueueDecision for the fast lane.
export async function recordConsultDecision(
  db: SupabaseClient,
  bookingRefId: string,
  decision: ConsultDecision,
): Promise<void> {
  const { error } = await db
    .from('booking_ref')
    .update({
      status: decision.status,
      decided_by: decision.decidedBy,
      decided_at: new Date().toISOString(),
      note_ref: decision.noteRef,
      rx_ref: decision.rxRef ?? null,
    })
    .eq('id', bookingRefId);
  if (error) throw new Error(`recordConsultDecision: ${error.message}`);
}
