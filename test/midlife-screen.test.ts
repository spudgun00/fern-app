import { afterAll, describe, expect, it } from 'vitest';
import { readEnv } from '../src/lib/env';
import { createAdminClient } from '../src/lib/supabase/admin';
import { MockCore } from '../src/lib/adapters/mock-core';
import { getScreening } from '../src/lib/adapters/factory';
import { startMidlifeScreen } from '../src/lib/screening/order';
import {
  MIDLIFE_SCREEN,
  SHARED_PANEL,
  fshIndicated,
  midlifeScreenPanel,
} from '../src/lib/screening/panel';
import { ensureAccount, getJourney, getLatestScreeningRef, setCorePatientId, setJourney } from '../src/lib/accounts';

// ===========================================================================
// Weight roadmap P5 — one screening subsystem, two front doors. The menopause
// "Midlife Health Screen" reuses the SAME adapter + branch + guard as the weight
// lane, is SCREEN-FRAMED (never a diagnosis), and follows the NICE FSH rule.
// ===========================================================================

describe('fshIndicated (NICE NG23 FSH rule)', () => {
  it('aged 40-45 WITH symptoms -> indicated', () => {
    expect(fshIndicated({ age: 43, hasMenopausalSymptoms: true, suspectedPOI: false }).indicated).toBe(true);
    expect(fshIndicated({ age: 40, hasMenopausalSymptoms: true, suspectedPOI: false }).indicated).toBe(true);
  });
  it('aged 40-45 WITHOUT symptoms -> not indicated', () => {
    expect(fshIndicated({ age: 43, hasMenopausalSymptoms: false, suspectedPOI: false }).indicated).toBe(false);
  });
  it('under 40 with suspected POI -> indicated', () => {
    expect(fshIndicated({ age: 37, hasMenopausalSymptoms: true, suspectedPOI: true }).indicated).toBe(true);
  });
  it('over 45 -> NOT indicated even with symptoms (NG23 diagnoses clinically)', () => {
    expect(fshIndicated({ age: 52, hasMenopausalSymptoms: true, suspectedPOI: false }).indicated).toBe(false);
  });
});

describe('midlifeScreenPanel (shared panel + conditional FSH)', () => {
  it('always includes the shared panel', () => {
    const panel = midlifeScreenPanel({ age: 52, hasMenopausalSymptoms: true, suspectedPOI: false });
    for (const m of SHARED_PANEL) expect(panel).toContain(m);
  });
  it('appends FSH only where NICE indicates it', () => {
    expect(midlifeScreenPanel({ age: 43, hasMenopausalSymptoms: true, suspectedPOI: false })).toContain('fsh');
    expect(midlifeScreenPanel({ age: 52, hasMenopausalSymptoms: true, suspectedPOI: false })).not.toContain('fsh');
  });
});

describe('the menopause screen is SCREEN-FRAMED, not a diagnosis', () => {
  it('the framing states it is a health screen, not a diagnosis', () => {
    expect(MIDLIFE_SCREEN.disclaimer).toMatch(/health screen/i);
    expect(MIDLIFE_SCREEN.disclaimer).toMatch(/not a diagnosis/i);
  });
  it('the framing makes NO claim to diagnose menopause', () => {
    const allCopy = [
      MIDLIFE_SCREEN.title,
      MIDLIFE_SCREEN.standfirst,
      MIDLIFE_SCREEN.disclaimer,
      MIDLIFE_SCREEN.panelLabel,
    ].join(' ');
    expect(allCopy).not.toMatch(/diagnos\w*\s+(your\s+)?menopause/i);
    expect(allCopy).not.toMatch(/diagnoses?\s+menopause/i);
  });
});

const env = { ...readEnv(), CORE_IMPL: 'mock', SCREENING_IMPL: 'mock' };
const admin = createAdminClient(env);
const core = new MockCore(admin);
const createdAccounts: string[] = [];

afterAll(async () => {
  for (const id of createdAccounts) {
    await admin.from('account').delete().eq('id', id);
  }
});

describe('one screening flow, reachable from the menopause front door', () => {
  it('startMidlifeScreen orders the SAME kit + walks the SAME branch as the weight lane', { timeout: 60_000 }, async () => {
    const account = await ensureAccount(admin, crypto.randomUUID());
    createdAccounts.push(account.id);
    const corePatientId = await core.createPatient({ fullName: 'Midlife Screen Patient' });
    await setCorePatientId(admin, account.id, corePatientId);
    await setJourney(admin, account.id, 'intake_submitted', null);

    const screening = getScreening(env, admin);
    const kitRef = await startMidlifeScreen(admin, screening, account.id, corePatientId);

    expect(kitRef).toBeTruthy();
    // Same branch as the weight lane: intake_submitted -> screening_kit_sent, with
    // the same screening_ref pointer + the same guard downstream.
    expect((await getJourney(admin, account.id))?.state).toBe('screening_kit_sent');
    expect((await getLatestScreeningRef(admin, account.id))?.status).toBe('kit_sent');
  });
});
