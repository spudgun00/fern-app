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
// MockCoreB: a second, trivial in-memory implementation of the SAME
// ClinicalCoreAdapter interface. Its only job is to prove that swapping the
// clinical-record host requires ZERO app or harness code changes — the factory
// flag (CORE_IMPL=mockB) selects it and everything else is untouched.
//
// In-memory means state does not survive across requests/worker instances, so
// it is used for the host-agnosticism test, not for the persisted dev harness.
// ============================================================================
export class MockCoreB implements ClinicalCoreAdapter {
  private readonly patients = new Map<string, CorePatient>();
  private readonly intakes = new Map<string, CoreIntake>();
  private readonly notes = new Map<string, { corePatientId: string; note: ConsultNote }>();
  private readonly prescriptions = new Map<string, Rx>();
  private readonly repeats = new Map<string, { corePatientId: string; rxRef: string }>();

  async createPatient(profile: PatientProfile): Promise<string> {
    const id = crypto.randomUUID();
    this.patients.set(id, { id, profile, createdAt: new Date().toISOString() });
    return id;
  }

  async getPatient(corePatientId: string): Promise<CorePatient | null> {
    return this.patients.get(corePatientId) ?? null;
  }

  async saveIntake(corePatientId: string, intakePayload: IntakePayload): Promise<string> {
    const id = crypto.randomUUID();
    this.intakes.set(id, {
      id,
      corePatientId,
      payload: intakePayload,
      status: 'submitted',
      createdAt: new Date().toISOString(),
    });
    return id;
  }

  async getIntake(intakeId: string): Promise<CoreIntake | null> {
    return this.intakes.get(intakeId) ?? null;
  }

  async listReviewQueue(filter: ReviewQueueFilter): Promise<IntakeSummary[]> {
    return [...this.intakes.values()]
      .filter((i) => (filter.lane ? i.payload.lane === filter.lane : true))
      .filter((i) => (filter.status ? i.status === filter.status : true))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((i) => ({
        intakeId: i.id,
        corePatientId: i.corePatientId,
        lane: i.payload.lane,
        status: i.status,
        createdAt: i.createdAt,
      }));
  }

  async createConsultNote(corePatientId: string, note: ConsultNote): Promise<string> {
    const id = crypto.randomUUID();
    this.notes.set(id, { corePatientId, note });
    return id;
  }

  async issuePrescription(corePatientId: string, rxRequest: RxRequest): Promise<string> {
    const id = crypto.randomUUID();
    this.prescriptions.set(id, {
      id,
      corePatientId,
      request: rxRequest,
      issuedAt: new Date().toISOString(),
    });
    return id;
  }

  async getPrescriptions(corePatientId: string): Promise<Rx[]> {
    return [...this.prescriptions.values()].filter((rx) => rx.corePatientId === corePatientId);
  }

  async createRepeatRequest(corePatientId: string, rxRef: string): Promise<string> {
    const id = crypto.randomUUID();
    this.repeats.set(id, { corePatientId, rxRef });
    return id;
  }
}
