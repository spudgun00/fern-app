import type { IntakeAnswers } from './routing';

// ===========================================================================
// P2 questionnaire definition (menopause / HRT). This is the clinically-set
// SCREENING CONTENT as static config: the symptom list and the field shapes the
// form renders and the submit route parses. The patient's ANSWERS are Article 9
// and live only in the clinical core; this file holds only the question
// structure, not anyone's answers.
// ===========================================================================

// Administrative product category, not clinical content. Stored in the core
// intake payload, never in the app DB.
export const CONDITION = 'menopause';

export const SYMPTOM_OPTIONS = [
  { id: 'hot_flushes', label: 'Hot flushes' },
  { id: 'night_sweats', label: 'Night sweats' },
  { id: 'sleep', label: 'Disturbed sleep' },
  { id: 'mood', label: 'Low mood or anxiety' },
  { id: 'vaginal_dryness', label: 'Vaginal dryness' },
  { id: 'brain_fog', label: 'Brain fog or poor concentration' },
] as const;

const SYMPTOM_IDS = SYMPTOM_OPTIONS.map((s) => s.id) as readonly string[];

// The risk + red-flag yes/no questions, rendered identically. `risk` routes to
// the assessed lane; `redFlag` stops + signposts. Order is the display order.
export const SCREEN_QUESTIONS = [
  { name: 'clotHistory', kind: 'risk', label: 'Have you ever had a blood clot (DVT or pulmonary embolism)?' },
  { name: 'breastCancerHistory', kind: 'risk', label: 'Have you ever been diagnosed with breast cancer?' },
  { name: 'liverDisease', kind: 'risk', label: 'Do you have a history of liver disease?' },
  {
    name: 'unexplainedBleeding',
    kind: 'redFlag',
    label: 'Have you had any unexplained vaginal bleeding (for example bleeding after the menopause)?',
  },
  { name: 'currentPregnancy', kind: 'redFlag', label: 'Is there any chance you could currently be pregnant?' },
  {
    name: 'suspectedClotSymptoms',
    kind: 'redFlag',
    label: 'Do you currently have a painful, swollen leg, or sudden breathlessness or chest pain?',
  },
  {
    name: 'undiagnosedBreastLump',
    kind: 'redFlag',
    label: 'Have you noticed a new breast lump or change that has not been checked by a doctor?',
  },
] as const;

// Parses a posted form into the typed answer set. Defensive defaults lean
// SAFE: an unclear treatment-history answer is treated as initiation (assessed
// lane), so a malformed post never silently lands in the fast lane.
export function parseIntakeAnswers(form: FormData): IntakeAnswers {
  const num = (value: FormDataEntryValue | null): number | null => {
    const s = String(value ?? '').trim();
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  const yes = (name: string): boolean => form.get(name) === 'yes';

  const selected = form.getAll('symptoms').map(String);
  const symptoms = SYMPTOM_IDS.filter((id) => selected.includes(id));

  return {
    treatmentHistory: form.get('treatmentHistory') === 'continuing' ? 'continuing' : 'initiation',
    symptoms,
    monthsSinceLastPeriod: num(form.get('monthsSinceLastPeriod')),
    bpSystolic: num(form.get('bpSystolic')),
    bpDiastolic: num(form.get('bpDiastolic')),
    clotHistory: yes('clotHistory'),
    breastCancerHistory: yes('breastCancerHistory'),
    liverDisease: yes('liverDisease'),
    unexplainedBleeding: yes('unexplainedBleeding'),
    currentPregnancy: yes('currentPregnancy'),
    suspectedClotSymptoms: yes('suspectedClotSymptoms'),
    undiagnosedBreastLump: yes('undiagnosedBreastLump'),
  };
}
