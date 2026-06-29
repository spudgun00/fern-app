import { describe, expect, it } from 'vitest';
import { readEnv } from '../src/lib/env';
import { createAdminClient } from '../src/lib/supabase/admin';
import { getClinicalCore } from '../src/lib/adapters/factory';

// The SAME round-trip runs against both implementations, selected ONLY via the
// CORE_IMPL factory flag. No test or harness code changes between them — this
// is the host-agnosticism proof.
//   - 'mock'  -> MockCore, persisted to Supabase mock_* tables (network)
//   - 'mockB' -> MockCoreB, in-memory
const IMPLS = ['mock', 'mockB'] as const;

describe('ClinicalCoreAdapter round-trip (host-agnostic via factory flag)', () => {
  for (const impl of IMPLS) {
    it(`createPatient -> saveIntake -> getIntake is consistent (CORE_IMPL=${impl})`, async () => {
      const env = { ...readEnv(), CORE_IMPL: impl };
      const admin = createAdminClient(env);
      const core = getClinicalCore(env, admin);

      const corePatientId = await core.createPatient({
        fullName: 'Test Patient',
        email: 'roundtrip@example.com',
      });
      expect(corePatientId).toBeTruthy();

      const patient = await core.getPatient(corePatientId);
      expect(patient?.id).toBe(corePatientId);
      expect(patient?.profile.fullName).toBe('Test Patient');

      const payload = {
        condition: 'menopause',
        lane: 'fast' as const,
        answers: { repeat: true, redFlags: false },
      };
      const intakeId = await core.saveIntake(corePatientId, payload);
      expect(intakeId).toBeTruthy();

      const intake = await core.getIntake(intakeId);
      expect(intake?.id).toBe(intakeId);
      expect(intake?.corePatientId).toBe(corePatientId);
      expect(intake?.payload.condition).toBe('menopause');
      expect(intake?.payload.lane).toBe('fast');
      expect((intake?.payload.answers as { repeat: boolean }).repeat).toBe(true);
    });
  }
});
