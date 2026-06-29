import type { Lane } from '../journey/states';

// The clinical boundary. ALL clinical-record and prescribing operations go
// through this one interface, so the rest of the app stays record-host-agnostic
// (light core vs Semble vs mock). Every light-vs-Semble flag lives here and
// nowhere else.
//
// Article 9 / clinical content lives ONLY behind this adapter, never in the app
// DB. Signatures are fixed now even though later phases use most methods, so the
// contract is locked.

export interface PatientProfile {
  // Demographic identity used to create a core patient record. In production
  // this lives in the rented core, not the app DB.
  email?: string;
  fullName?: string;
  dateOfBirth?: string;
  [key: string]: unknown;
}

export interface CorePatient {
  id: string;
  profile: PatientProfile;
  createdAt: string;
}

export interface IntakePayload {
  // The structured clinical intake. Article 9 content — lives ONLY in the core.
  condition: string;
  lane: Lane;
  answers: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CoreIntake {
  id: string;
  corePatientId: string;
  payload: IntakePayload;
  status: string;
  createdAt: string;
}

export interface IntakeSummary {
  intakeId: string;
  corePatientId: string;
  lane: Lane;
  status: string;
  createdAt: string;
}

export interface ReviewQueueFilter {
  lane?: Lane;
  status?: string;
}

export interface ConsultNote {
  text: string;
  clinicianRef: string;
  [key: string]: unknown;
}

export interface RxRequest {
  items: Array<{ name: string; dose?: string; quantity?: number }>;
  clinicianRef: string;
  // The clinician-decision state this script follows from. The journey guard
  // independently enforces that rx_issued is only reachable from these.
  decisionState: 'approved' | 'consult_done';
  [key: string]: unknown;
}

export interface Rx {
  id: string;
  corePatientId: string;
  request: RxRequest;
  issuedAt: string;
}

export interface ClinicalCoreAdapter {
  createPatient(profile: PatientProfile): Promise<string>;
  getPatient(corePatientId: string): Promise<CorePatient | null>;
  saveIntake(corePatientId: string, intakePayload: IntakePayload): Promise<string>;
  getIntake(intakeId: string): Promise<CoreIntake | null>;
  listReviewQueue(filter: ReviewQueueFilter): Promise<IntakeSummary[]>;
  createConsultNote(corePatientId: string, note: ConsultNote): Promise<string>;
  issuePrescription(corePatientId: string, rxRequest: RxRequest): Promise<string>;
  getPrescriptions(corePatientId: string): Promise<Rx[]>;
  createRepeatRequest(corePatientId: string, rxRef: string): Promise<string>;
}
