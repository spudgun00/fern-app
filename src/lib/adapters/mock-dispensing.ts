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
}
