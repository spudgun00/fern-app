// The screening (at-home blood test) boundary. Mocked this phase behind the same
// kind of adapter as the clinical core / dispensing, so swapping in the real
// UKAS-accredited lab partner later needs no app changes.
//
// HARD LINE: the RESULTS (the panel marker values) are UK GDPR Article 9 clinical
// content and live ONLY behind this adapter. The app DB (screening_ref) holds a
// pointer + a coarse status only. The bloods are an INPUT to the clinician's
// decision, never a decision-maker: this adapter reports status + results, it
// never approves or issues anything.

export type ScreeningStatus = 'kit_sent' | 'sample_received' | 'results_ready' | string;

export interface ScreeningKit {
  kitId: string;
  corePatientId: string;
  status: ScreeningStatus;
  orderedAt: string;
}

// The panel a screening returns. Clinical-shaped (Article 9) — it lives ONLY
// behind this adapter, never in the app DB. `flag` is a coarse in-range hint for
// display; the clinician reads the full picture, the app never acts on it.
export interface ScreeningMarker {
  marker: string; // e.g. 'cholesterol', 'hba1c', 'liver', 'thyroid'
  value?: string;
  flag?: 'normal' | 'low' | 'high' | string;
}

export interface ScreeningResults {
  kitId: string;
  corePatientId: string;
  panel: ScreeningMarker[];
  reportedAt: string;
}

export interface ScreeningAdapter {
  // Order an at-home kit for a patient. Returns the provider kit id (kit_ref).
  orderKit(corePatientId: string): Promise<string>;
  // The coarse workflow status of a kit (kit_sent -> sample_received ->
  // results_ready). Drives the journey; carries no clinical values.
  getKitStatus(kitId: string): Promise<ScreeningKit | null>;
  // The panel results, available once the kit reaches results_ready. Article 9;
  // returned for the clinician's review, never persisted to the app DB.
  getResults(kitId: string): Promise<ScreeningResults | null>;
}
