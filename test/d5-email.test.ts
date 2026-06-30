import { afterAll, describe, expect, it } from 'vitest';
import { readEnv } from '../src/lib/env';
import { createAdminClient } from '../src/lib/supabase/admin';
import { getEmail } from '../src/lib/adapters/factory';
import { MockEmail } from '../src/lib/adapters/mock-email';
import { ResendEmail } from '../src/lib/adapters/resend-email';
import type { EmailAdapter, EmailMessage, EmailSendResult } from '../src/lib/adapters/email';
import {
  welcomeEmail,
  consultBookedEmail,
  scriptShippedEmail,
} from '../src/lib/email/templates';
import { sendWelcomeEmail } from '../src/lib/email/notify';
import { MockCore } from '../src/lib/adapters/mock-core';
import { MockDispensing } from '../src/lib/adapters/mock-dispensing';
import { submitIntake } from '../src/lib/intake/submit';
import { decideClinicianAction } from '../src/lib/clinician/decide';
import { dispenseIssuedScript } from '../src/lib/dispensing/dispense';
import type { IntakeAnswers } from '../src/lib/intake/routing';
import { ensureAccount, getJourney, setCorePatientId, setJourney } from '../src/lib/accounts';

// ===========================================================================
// D5 — transactional email. Two things to prove:
//   1. the adapter round-trip + the templates compose correctly (and carry NO
//      clinical content — status + next step only);
//   2. email NEVER gates a flow: a throwing send is swallowed, and the dispense
//      flow still advances even with an email adapter wired in.
// ===========================================================================

const BASE = 'https://fern-app.example.workers.dev';

// A send that always fails, to prove the never-gates swallow.
class ThrowingEmail implements EmailAdapter {
  async send(): Promise<EmailSendResult> {
    throw new Error('provider down');
  }
}

describe('EmailAdapter round-trip (MockEmail records the composed message)', () => {
  it('records what it sends and reports it as logged (no network)', async () => {
    const email = new MockEmail();
    const message: EmailMessage = {
      to: 'patient@example.com',
      subject: 'Hello',
      html: '<p>hi</p>',
      text: 'hi',
    };
    const result = await email.send(message);
    expect(result.status).toBe('logged');
    expect(result.id).toBeTruthy();
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]).toEqual(message);
  });

  it('the factory returns MockEmail by default (zero-keys walk)', () => {
    const env = { ...readEnv(), EMAIL_IMPL: 'mock' };
    expect(getEmail(env)).toBeInstanceOf(MockEmail);
  });

  it('selecting resend without a key is rejected (the mock stays the safe default)', () => {
    // readEnv guards: EMAIL_IMPL=resend requires RESEND_API_KEY.
    expect(() => readEnv({ ...process.env, EMAIL_IMPL: 'resend', RESEND_API_KEY: '' })).toThrow(
      /RESEND_API_KEY/,
    );
    // And the adapter itself guards if constructed empty.
    expect(() => new ResendEmail('', 'Fern <noreply@mail.fern.care>')).toThrow(/RESEND_API_KEY/);
  });
});

describe('templates compose status + next-step copy, never clinical content', () => {
  const all = [
    welcomeEmail(BASE),
    consultBookedEmail(BASE, '2026-07-15T09:30:00.000Z'),
    consultBookedEmail(BASE, null),
    scriptShippedEmail(BASE),
  ];

  it('each email has a subject, html and text, and links back into the app', () => {
    for (const m of all) {
      expect(m.subject).toBeTruthy();
      expect(m.html).toContain('Fern');
      expect(m.text).toBeTruthy();
      expect(m.html).toContain(BASE);
    }
  });

  it('the welcome points at onboarding, booked at the consult, shipped at treatment', () => {
    expect(welcomeEmail(BASE).html).toContain(`${BASE}/account/profile`);
    expect(consultBookedEmail(BASE, null).html).toContain(`${BASE}/consult`);
    expect(scriptShippedEmail(BASE).html).toContain(`${BASE}/treatment`);
  });

  it('a booked email with a slot renders a UK-formatted time', () => {
    const m = consultBookedEmail(BASE, '2026-07-15T09:30:00.000Z');
    // 15 July 2026 is a Wednesday; en-GB / Europe/London formatting.
    expect(m.html).toContain('Wednesday');
    expect(m.html).toContain('July');
  });

  it('carries NO Article 9 / clinical detail (status + next step only)', () => {
    // A denylist of clinical terms that must never appear in a notification body.
    const banned = [
      'menopause',
      'oestrogen',
      'estrogen',
      'estradiol',
      'testosterone',
      'symptom',
      'diagnos',
      'dose',
      'mg',
      'bleeding',
      'breast',
      'clot',
    ];
    for (const m of all) {
      const haystack = `${m.subject} ${m.html} ${m.text}`.toLowerCase();
      for (const term of banned) {
        expect(haystack, `"${term}" must not appear in an email body`).not.toContain(term);
      }
    }
  });
});

describe('email NEVER gates a flow', () => {
  it('a throwing send is swallowed by the notify helper (returns normally)', async () => {
    await expect(
      sendWelcomeEmail(new ThrowingEmail(), 'patient@example.com', BASE),
    ).resolves.toBeUndefined();
  });
});

// --- end-to-end: the dispense flow advances even with email wired in ---------

function fastLaneAnswers(): IntakeAnswers {
  return {
    treatmentHistory: 'continuing',
    symptoms: ['hot_flushes', 'night_sweats'],
    monthsSinceLastPeriod: 18,
    bpSystolic: 124,
    bpDiastolic: 78,
    clotHistory: false,
    breastCancerHistory: false,
    liverDisease: false,
    unexplainedBleeding: false,
    currentPregnancy: false,
    suspectedClotSymptoms: false,
    undiagnosedBreastLump: false,
  };
}

const env = { ...readEnv(), CORE_IMPL: 'mock', DISPENSING_IMPL: 'mock', IDENTITY_IMPL: 'mock' };
const admin = createAdminClient(env);
const core = new MockCore(admin);
const dispensing = new MockDispensing(admin);
const createdAccounts: string[] = [];

async function patientWithIssuedScript() {
  const clinician = await ensureAccount(admin, crypto.randomUUID());
  createdAccounts.push(clinician.id);
  await admin.from('account').update({ role: 'clinician' }).eq('id', clinician.id);

  const account = await ensureAccount(admin, crypto.randomUUID());
  createdAccounts.push(account.id);
  const corePatientId = await core.createPatient({ fullName: 'D5 Test Patient' });
  await setCorePatientId(admin, account.id, corePatientId);
  await setJourney(admin, account.id, 'id_verified', null);
  await submitIntake(admin, core, account.id, corePatientId, 'menopause', fastLaneAnswers());

  const { data } = await admin.from('queue_item').select('*').eq('account_id', account.id).single();
  const result = await decideClinicianAction(admin, core, {
    clinicianAccountId: clinician.id,
    queueItemId: data.id,
    action: 'approve',
    reason: 'Clear continuing picture, no contraindications.',
    rxItems: [{ name: 'Transdermal HRT', dose: 'as directed', quantity: 1 }],
  });
  return { accountId: account.id, corePatientId, rxId: result.rxId! };
}

afterAll(async () => {
  for (const id of createdAccounts) {
    await admin.from('account').delete().eq('id', id);
  }
});

describe('dispenseIssuedScript with email wired in', () => {
  it('still advances rx_issued -> dispensing even when the email adapter throws', async () => {
    const { accountId, corePatientId, rxId } = await patientWithIssuedScript();
    expect((await getJourney(admin, accountId))?.state).toBe('rx_issued');

    const result = await dispenseIssuedScript(
      admin,
      core,
      dispensing,
      { accountId, corePatientId, rxId },
      { email: new ThrowingEmail(), baseUrl: BASE },
    );

    expect(result.status).toBe('submitted');
    // The hard line: the transition happened regardless of the email outcome.
    expect((await getJourney(admin, accountId))?.state).toBe('dispensing');
  });
});
