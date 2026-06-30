import type { SupabaseClient } from '@supabase/supabase-js';
import type { EmailAdapter } from '../adapters/email';
import { getAccountById } from '../accounts';
import { welcomeEmail, consultBookedEmail, scriptShippedEmail } from './templates';

// ===========================================================================
// The notification layer (D5). This is the ONLY place a journey event is turned
// into a send, and it COMPOSES with the flow — it never gates it. Every helper is
// wrapped so a failed send logs and is swallowed: the transition has already
// happened by the time we get here, and email is a side effect, never a barrier.
//
// HARD LINE: these helpers pass only status + next-step copy to the templates;
// no clinical content is read or forwarded (the templates carry no Article 9 by
// construction). Recipient resolution reads the auth user's email via the admin
// client — non-clinical, app-side only.
// ===========================================================================

// Resolve the patient's email from the account -> auth user. Returns null (never
// throws) if anything is missing, so a send is simply skipped.
async function recipientFor(admin: SupabaseClient, accountId: string): Promise<string | null> {
  try {
    const account = await getAccountById(admin, accountId);
    if (!account) return null;
    const { data, error } = await admin.auth.admin.getUserById(account.auth_user_id);
    if (error || !data.user?.email) return null;
    return data.user.email;
  } catch {
    return null;
  }
}

// Run a send, swallowing + logging any failure. Email NEVER gates a flow.
async function safeSend(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[email:${label}] send failed (non-blocking):`, err);
  }
}

// Welcome — account created. The recipient is known at sign-up, so it is passed
// directly (no lookup needed).
export async function sendWelcomeEmail(
  email: EmailAdapter,
  to: string,
  baseUrl: string,
): Promise<void> {
  if (!to) return;
  await safeSend('welcome', () => email.send({ to, ...welcomeEmail(baseUrl) }));
}

// Consult booked — fired once, right after intake_submitted/escalated ->
// consult_booked. slotAt is scheduling data only.
export async function sendConsultBookedEmail(
  admin: SupabaseClient,
  email: EmailAdapter,
  accountId: string,
  baseUrl: string,
  slotAt: string | null,
): Promise<void> {
  const to = await recipientFor(admin, accountId);
  if (!to) return;
  await safeSend('consult-booked', () =>
    email.send({ to, ...consultBookedEmail(baseUrl, slotAt) }),
  );
}

// Script shipped — fired once, right after rx_issued -> dispensing. Status only;
// no medication name, no clinical reason.
export async function sendScriptShippedEmail(
  admin: SupabaseClient,
  email: EmailAdapter,
  accountId: string,
  baseUrl: string,
): Promise<void> {
  const to = await recipientFor(admin, accountId);
  if (!to) return;
  await safeSend('script-shipped', () => email.send({ to, ...scriptShippedEmail(baseUrl) }));
}
