import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ClinicalCoreAdapter,
  ConsultNote,
  CoreIntake,
  CorePatient,
  IntakePayload,
  IntakeSummary,
  PatientProfile,
  ReviewQueueFilter,
  Rx,
  RxRequest,
} from './clinical-core';

// ============================================================================
// MockCore: a THROWAWAY DEV STAND-IN for the rented clinical core, NOT the
// production data model. It persists clinical-SHAPED data to namespaced mock_*
// tables in Supabase so adapter round-trips survive across requests and are
// inspectable. This is the ONE place mock clinical-shaped data may sit in
// Supabase: it is fake, dev-only, and namespaced. Deleted when the real core
// (light core / Semble) is wired behind the same ClinicalCoreAdapter interface.
// ============================================================================
export class MockCore implements ClinicalCoreAdapter {
  constructor(private readonly db: SupabaseClient) {}

  private fail(op: string, message: string): never {
    throw new Error(`MockCore.${op}: ${message}`);
  }

  async createPatient(profile: PatientProfile): Promise<string> {
    const id = crypto.randomUUID();
    const { error } = await this.db
      .from('mock_core_patient')
      .insert({ id, profile });
    if (error) this.fail('createPatient', error.message);
    return id;
  }

  async getPatient(corePatientId: string): Promise<CorePatient | null> {
    const { data, error } = await this.db
      .from('mock_core_patient')
      .select('*')
      .eq('id', corePatientId)
      .maybeSingle();
    if (error) this.fail('getPatient', error.message);
    if (!data) return null;
    return { id: data.id, profile: data.profile, createdAt: data.created_at };
  }

  async saveIntake(corePatientId: string, intakePayload: IntakePayload): Promise<string> {
    const id = crypto.randomUUID();
    const { error } = await this.db.from('mock_core_intake').insert({
      id,
      core_patient_id: corePatientId,
      payload: intakePayload,
      status: 'submitted',
      lane: intakePayload.lane,
    });
    if (error) this.fail('saveIntake', error.message);
    return id;
  }

  async getIntake(intakeId: string): Promise<CoreIntake | null> {
    const { data, error } = await this.db
      .from('mock_core_intake')
      .select('*')
      .eq('id', intakeId)
      .maybeSingle();
    if (error) this.fail('getIntake', error.message);
    if (!data) return null;
    return {
      id: data.id,
      corePatientId: data.core_patient_id,
      payload: data.payload,
      status: data.status,
      createdAt: data.created_at,
    };
  }

  async listReviewQueue(filter: ReviewQueueFilter): Promise<IntakeSummary[]> {
    let query = this.db
      .from('mock_core_intake')
      .select('*')
      .order('created_at', { ascending: true });
    if (filter.lane) query = query.eq('lane', filter.lane);
    if (filter.status) query = query.eq('status', filter.status);
    const { data, error } = await query;
    if (error) this.fail('listReviewQueue', error.message);
    return (data ?? []).map((row) => ({
      intakeId: row.id,
      corePatientId: row.core_patient_id,
      lane: row.lane,
      status: row.status,
      createdAt: row.created_at,
    }));
  }

  async createConsultNote(corePatientId: string, note: ConsultNote): Promise<string> {
    const id = crypto.randomUUID();
    const { error } = await this.db
      .from('mock_core_consult_note')
      .insert({ id, core_patient_id: corePatientId, note });
    if (error) this.fail('createConsultNote', error.message);
    return id;
  }

  async issuePrescription(corePatientId: string, rxRequest: RxRequest): Promise<string> {
    const id = crypto.randomUUID();
    const { error } = await this.db
      .from('mock_core_prescription')
      .insert({ id, core_patient_id: corePatientId, rx: rxRequest });
    if (error) this.fail('issuePrescription', error.message);
    return id;
  }

  async getPrescriptions(corePatientId: string): Promise<Rx[]> {
    const { data, error } = await this.db
      .from('mock_core_prescription')
      .select('*')
      .eq('core_patient_id', corePatientId)
      .order('created_at', { ascending: true });
    if (error) this.fail('getPrescriptions', error.message);
    return (data ?? []).map((row) => ({
      id: row.id,
      corePatientId: row.core_patient_id,
      request: row.rx,
      issuedAt: row.created_at,
    }));
  }

  async createRepeatRequest(corePatientId: string, rxRef: string): Promise<string> {
    const id = crypto.randomUUID();
    const { error } = await this.db
      .from('mock_core_repeat_request')
      .insert({ id, core_patient_id: corePatientId, rx_ref: rxRef });
    if (error) this.fail('createRepeatRequest', error.message);
    return id;
  }
}
