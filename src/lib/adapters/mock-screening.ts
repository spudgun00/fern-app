import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ScreeningAdapter,
  ScreeningKit,
  ScreeningResults,
  ScreeningStatus,
} from './screening';

// ============================================================================
// MockScreening: a THROWAWAY DEV STAND-IN for the screening lab partner API, NOT
// the production data model. Persists to the namespaced mock_screening table.
// The fake panel is clinical-shaped and lives ONLY here, behind the adapter.
// Deleted when the real UKAS-accredited lab adapter is wired behind
// ScreeningAdapter.
// ============================================================================
export class MockScreening implements ScreeningAdapter {
  constructor(private readonly db: SupabaseClient) {}

  private fail(op: string, message: string): never {
    throw new Error(`MockScreening.${op}: ${message}`);
  }

  async orderKit(corePatientId: string): Promise<string> {
    const id = crypto.randomUUID();
    const { error } = await this.db.from('mock_screening').insert({
      id,
      core_patient_id: corePatientId,
      status: 'kit_sent',
      results: {},
    });
    if (error) this.fail('orderKit', error.message);
    return id;
  }

  async getKitStatus(kitId: string): Promise<ScreeningKit | null> {
    const { data, error } = await this.db
      .from('mock_screening')
      .select('*')
      .eq('id', kitId)
      .maybeSingle();
    if (error) this.fail('getKitStatus', error.message);
    if (!data) return null;
    return {
      kitId: data.id,
      corePatientId: data.core_patient_id,
      status: data.status,
      orderedAt: data.created_at,
    };
  }

  async getResults(kitId: string): Promise<ScreeningResults | null> {
    const { data, error } = await this.db
      .from('mock_screening')
      .select('*')
      .eq('id', kitId)
      .maybeSingle();
    if (error) this.fail('getResults', error.message);
    if (!data) return null;
    if (data.status !== 'results_ready') return null; // no panel until the bloods are in
    const results = (data.results ?? {}) as Partial<ScreeningResults>;
    return {
      kitId: data.id,
      corePatientId: data.core_patient_id,
      panel: results.panel ?? [],
      reportedAt: results.reportedAt ?? data.created_at,
    };
  }

  // MOCK-ONLY test/dev affordance (NOT part of the ScreeningAdapter interface).
  // The real lab pushes status changes via its own API/webhook; here a dev step
  // advances the mock kit_sent -> sample_received -> results_ready, attaching a
  // fake shared-panel result (cholesterol / HbA1c / liver / thyroid) at the final
  // step so the screening walk is exercisable end to end. Returns the new status
  // (unchanged once results_ready, the terminal mock state).
  async advanceKit(kitId: string, now: string): Promise<ScreeningStatus> {
    const NEXT: Record<string, string> = {
      kit_sent: 'sample_received',
      sample_received: 'results_ready',
    };
    const { data, error } = await this.db
      .from('mock_screening')
      .select('*')
      .eq('id', kitId)
      .maybeSingle();
    if (error) this.fail('advanceKit', error.message);
    if (!data) this.fail('advanceKit', `unknown kit ${kitId}`);

    const next = NEXT[data.status];
    if (!next) return data.status; // already results_ready (terminal): no-op.

    // Fake, illustrative panel — dev-only clinical-shaped data, never real.
    const results =
      next === 'results_ready'
        ? {
            panel: [
              { marker: 'cholesterol', value: '5.1 mmol/L', flag: 'normal' },
              { marker: 'hba1c', value: '39 mmol/mol', flag: 'normal' },
              { marker: 'liver', value: 'ALT 28 U/L', flag: 'normal' },
              { marker: 'thyroid', value: 'TSH 2.1 mU/L', flag: 'normal' },
            ],
            reportedAt: now,
          }
        : data.results;

    const { error: upErr } = await this.db
      .from('mock_screening')
      .update({ status: next, results })
      .eq('id', kitId);
    if (upErr) this.fail('advanceKit', upErr.message);
    return next;
  }
}
