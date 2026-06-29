// The CloudRx (dispensing) boundary. Mocked this phase behind the same kind of
// adapter as the clinical core, so swapping in the real CloudRx API later needs
// no app changes.

export interface DispensePrescription {
  rxId: string;
  corePatientId: string;
  [key: string]: unknown;
}

export interface DispenseStatus {
  dispenseId: string;
  status: 'submitted' | 'dispatched' | 'delivered' | string;
  updatedAt: string;
}

export interface DeliveryTracking {
  dispenseId: string;
  carrier?: string;
  trackingNumber?: string;
  events: Array<{ at: string; description: string }>;
}

export interface DispensingAdapter {
  submitPrescription(rx: DispensePrescription): Promise<string>;
  getDispenseStatus(dispenseId: string): Promise<DispenseStatus | null>;
  getDeliveryTracking(dispenseId: string): Promise<DeliveryTracking | null>;
}
