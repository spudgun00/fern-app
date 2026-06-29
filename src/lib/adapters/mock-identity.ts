import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  IdentityAdapter,
  VerificationSession,
  VerificationStatus,
} from './identity';

// ============================================================================
// MockIdentity: a THROWAWAY DEV STAND-IN for the real identity provider (Stripe
// Identity), NOT the production integration. It models the PROVIDER's own side
// of the verification, so its session store (mock_identity_verification) is the
// provider's record, not app-DB state. Like Stripe, it holds the session and
// status; it deliberately holds NO document images and NO extracted PII either,
// because the mock has none to hold. Deleted when the real provider is wired
// behind the same IdentityAdapter interface.
//
// Completion: a real provider verifies after the user finishes a hosted flow.
// The mock confirm page (/account/verify/mock) and the dev harness drive that
// via markVerified(), which is a MOCK-ONLY affordance and is NOT part of the
// IdentityAdapter interface (the real Stripe path is completed by the user in
// test mode, proven on the deployed URL).
// ============================================================================
export class MockIdentity implements IdentityAdapter {
  constructor(private readonly db: SupabaseClient) {}

  private fail(op: string, message: string): never {
    throw new Error(`MockIdentity.${op}: ${message}`);
  }

  async createVerificationSession(
    accountId: string,
    returnUrl: string,
  ): Promise<VerificationSession> {
    const id = crypto.randomUUID();
    const { error } = await this.db
      .from('mock_identity_verification')
      .insert({ id, account_id: accountId, status: 'requires_input' });
    if (error) this.fail('createVerificationSession', error.message);
    const clientUrl = `/account/verify/mock?session=${id}&return=${encodeURIComponent(returnUrl)}`;
    return { sessionId: id, clientUrl };
  }

  async getVerificationStatus(sessionId: string): Promise<VerificationStatus> {
    const { data, error } = await this.db
      .from('mock_identity_verification')
      .select('status')
      .eq('id', sessionId)
      .maybeSingle();
    if (error) this.fail('getVerificationStatus', error.message);
    if (!data) this.fail('getVerificationStatus', `unknown session ${sessionId}`);
    return data.status as VerificationStatus;
  }

  // MOCK-ONLY: simulate the user completing the hosted flow and the provider
  // deciding "verified". Not on the IdentityAdapter interface by design.
  async markVerified(sessionId: string): Promise<void> {
    const { error } = await this.db
      .from('mock_identity_verification')
      .update({ status: 'verified' })
      .eq('id', sessionId);
    if (error) this.fail('markVerified', error.message);
  }
}
