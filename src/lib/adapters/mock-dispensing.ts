import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DeliveryTracking,
  DispensePrescription,
  DispenseStatus,
  DispensingAdapter,
} from './dispensing';

// ============================================================================
// MockDispensing: a THROWAWAY DEV STAND-IN for the CloudRx dispensing API, NOT
// the production data model. Persists to the namespaced mock_dispense table.
// Deleted when the real CloudRx adapter is wired behind DispensingAdapter.
// ============================================================================
export class MockDispensing implements DispensingAdapter {
  constructor(private readonly db: SupabaseClient) {}

  private fail(op: string, message: string): never {
    throw new Error(`MockDispensing.${op}: ${message}`);
  }

  async submitPrescription(rx: DispensePrescription): Promise<string> {
    const id = crypto.randomUUID();
    const { error } = await this.db.from('mock_dispense').insert({
      id,
      rx,
      status: 'submitted',
      tracking: { dispenseId: id, events: [] },
    });
    if (error) this.fail('submitPrescription', error.message);
    return id;
  }

  async getDispenseStatus(dispenseId: string): Promise<DispenseStatus | null> {
    const { data, error } = await this.db
      .from('mock_dispense')
      .select('*')
      .eq('id', dispenseId)
      .maybeSingle();
    if (error) this.fail('getDispenseStatus', error.message);
    if (!data) return null;
    return { dispenseId: data.id, status: data.status, updatedAt: data.created_at };
  }

  async getDeliveryTracking(dispenseId: string): Promise<DeliveryTracking | null> {
    const { data, error } = await this.db
      .from('mock_dispense')
      .select('*')
      .eq('id', dispenseId)
      .maybeSingle();
    if (error) this.fail('getDeliveryTracking', error.message);
    if (!data) return null;
    const tracking = (data.tracking ?? {}) as Partial<DeliveryTracking>;
    return {
      dispenseId: data.id,
      carrier: tracking.carrier,
      trackingNumber: tracking.trackingNumber,
      events: tracking.events ?? [],
    };
  }

  // MOCK-ONLY test affordance (NOT part of the DispensingAdapter interface). The
  // real CloudRx pushes status changes via its own API/webhook; here a dev step
  // advances the mock through submitted -> dispatched -> delivered and appends a
  // tracking event, so the patient status view is walkable end to end. Returns
  // the new status (unchanged once delivered, the terminal mock state).
  async advanceStatus(dispenseId: string, now: string): Promise<DispenseStatus['status']> {
    const NEXT: Record<string, string> = { submitted: 'dispatched', dispatched: 'delivered' };
    const EVENT: Record<string, string> = {
      dispatched: 'Dispatched by the pharmacy',
      delivered: 'Delivered',
    };
    const { data, error } = await this.db
      .from('mock_dispense')
      .select('*')
      .eq('id', dispenseId)
      .maybeSingle();
    if (error) this.fail('advanceStatus', error.message);
    if (!data) this.fail('advanceStatus', `unknown dispense ${dispenseId}`);

    const next = NEXT[data.status];
    if (!next) return data.status; // already delivered (terminal): no-op.

    const tracking = (data.tracking ?? { dispenseId, events: [] }) as DeliveryTracking;
    const events = [...(tracking.events ?? []), { at: now, description: EVENT[next] }];
    const { error: upErr } = await this.db
      .from('mock_dispense')
      .update({ status: next, tracking: { ...tracking, dispenseId, events } })
      .eq('id', dispenseId);
    if (upErr) this.fail('advanceStatus', upErr.message);
    return next;
  }
}
