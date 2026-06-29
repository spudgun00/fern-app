import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppEnv } from '../env';
import type { ClinicalCoreAdapter } from './clinical-core';
import type { DispensingAdapter } from './dispensing';
import { MockCore } from './mock-core';
import { MockCoreB } from './mock-core-b';
import { MockDispensing } from './mock-dispensing';

// Selects the implementation purely from the env flag. The rest of the app
// (routes, harness, tests) only ever talks to the interface, so swapping the
// record host is a flag change with zero call-site edits. Default: mock.
export function getClinicalCore(env: AppEnv, db: SupabaseClient): ClinicalCoreAdapter {
  switch (env.CORE_IMPL) {
    case 'mockB':
      return new MockCoreB();
    case 'mock':
    default:
      return new MockCore(db);
  }
}

export function getDispensing(env: AppEnv, db: SupabaseClient): DispensingAdapter {
  switch (env.DISPENSING_IMPL) {
    case 'mock':
    default:
      return new MockDispensing(db);
  }
}
