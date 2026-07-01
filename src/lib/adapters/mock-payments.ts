import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CheckoutKind,
  CheckoutResult,
  CheckoutSession,
  PaymentsAdapter,
  PortalSession,
} from './payments';

// ============================================================================
// MockPayments: a THROWAWAY DEV STAND-IN for the real payments provider (Stripe
// Checkout + Billing), NOT the production integration. It models the PROVIDER's
// own side of a checkout, so its session store (mock_payment_session) is the
// provider's record, not app-DB state. Like Stripe it holds the session, its
// status, and the minted customer/subscription ids; it holds NO card data
// (the mock has none). Deleted when the real Stripe adapter is wired behind the
// same PaymentsAdapter interface.
//
// Completion: a real provider marks a session paid after the user finishes the
// hosted checkout. The mock checkout page (/account/billing/mock) and its
// confirm route drive that via markPaid(), a MOCK-ONLY affordance NOT part of
// the PaymentsAdapter interface (the real Stripe path is completed by the user
// in test mode, proven on the deployed URL). cancelSubscription() likewise
// stands in for a cancel taken in the provider's portal.
// ============================================================================
export class MockPayments implements PaymentsAdapter {
  constructor(private readonly db: SupabaseClient) {}

  private fail(op: string, message: string): never {
    throw new Error(`MockPayments.${op}: ${message}`);
  }

  async createCheckout(
    kind: CheckoutKind,
    accountId: string,
    returnUrl: string,
  ): Promise<CheckoutSession> {
    const id = crypto.randomUUID();
    const { error } = await this.db
      .from('mock_payment_session')
      .insert({ id, account_id: accountId, kind, status: 'open' });
    if (error) this.fail('createCheckout', error.message);
    const clientUrl =
      `/account/billing/mock?session=${id}&kind=${kind}&return=${encodeURIComponent(returnUrl)}`;
    return { sessionId: id, clientUrl };
  }

  async getCheckoutStatus(sessionId: string): Promise<CheckoutResult> {
    const { data, error } = await this.db
      .from('mock_payment_session')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle();
    if (error) this.fail('getCheckoutStatus', error.message);
    if (!data) this.fail('getCheckoutStatus', `unknown session ${sessionId}`);
    return {
      status: data.status as CheckoutResult['status'],
      kind: data.kind as CheckoutKind,
      customerRef: data.customer_ref ?? undefined,
      subscriptionRef: data.subscription_ref ?? undefined,
    };
  }

  async createPortalSession(customerRef: string, returnUrl: string): Promise<PortalSession> {
    const portalUrl =
      `/account/billing/mock-portal?customer=${encodeURIComponent(customerRef)}` +
      `&return=${encodeURIComponent(returnUrl)}`;
    return { portalUrl };
  }

  // MOCK-ONLY: simulate the user completing the hosted checkout and the provider
  // marking it paid. For a membership checkout this mints the customer +
  // subscription ids the real Stripe would create. Not on the PaymentsAdapter
  // interface by design.
  async markPaid(sessionId: string): Promise<void> {
    const { data, error } = await this.db
      .from('mock_payment_session')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle();
    if (error) this.fail('markPaid', error.message);
    if (!data) this.fail('markPaid', `unknown session ${sessionId}`);

    const patch: Record<string, unknown> = { status: 'complete' };
    if (data.kind === 'membership') {
      patch.customer_ref = data.customer_ref ?? `mock_cus_${crypto.randomUUID()}`;
      patch.subscription_ref = data.subscription_ref ?? `mock_sub_${crypto.randomUUID()}`;
    }
    const { error: upErr } = await this.db
      .from('mock_payment_session')
      .update(patch)
      .eq('id', sessionId);
    if (upErr) this.fail('markPaid', upErr.message);
  }

  // Refund a completed one-off payment (the pay-first weight treatment charge).
  // Part of the PaymentsAdapter interface — this is the automatic refund-on-refusal
  // path, so it is real behaviour, not a mock-only affordance. Marks the provider
  // session refunded (a real provider would move the money back to the card).
  async refund(sessionId: string): Promise<void> {
    const { data, error } = await this.db
      .from('mock_payment_session')
      .select('id,status')
      .eq('id', sessionId)
      .maybeSingle();
    if (error) this.fail('refund', error.message);
    if (!data) this.fail('refund', `unknown session ${sessionId}`);
    const { error: upErr } = await this.db
      .from('mock_payment_session')
      .update({ status: 'refunded' })
      .eq('id', sessionId);
    if (upErr) this.fail('refund', upErr.message);
  }

  // MOCK-ONLY: simulate a cancellation taken in the provider portal. The real
  // Stripe path emits a customer.subscription.deleted webhook instead. Returns
  // the customer ref so the caller can flip the membership state.
  async cancelByCustomer(customerRef: string): Promise<void> {
    const { error } = await this.db
      .from('mock_payment_session')
      .update({ status: 'canceled' })
      .eq('customer_ref', customerRef)
      .eq('kind', 'membership');
    if (error) this.fail('cancelByCustomer', error.message);
  }
}
