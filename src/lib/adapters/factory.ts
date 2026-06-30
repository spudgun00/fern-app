import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppEnv } from '../env';
import type { ClinicalCoreAdapter } from './clinical-core';
import type { DispensingAdapter } from './dispensing';
import type { IdentityAdapter } from './identity';
import type { PaymentsAdapter } from './payments';
import type { BookingAdapter } from './booking';
import type { VideoAdapter } from './video';
import { MockCore } from './mock-core';
import { MockCoreB } from './mock-core-b';
import { MockDispensing } from './mock-dispensing';
import { MockIdentity } from './mock-identity';
import { StripeIdentity } from './stripe-identity';
import { MockPayments } from './mock-payments';
import { StripePayments } from './stripe-payments';
import { MockBooking } from './mock-booking';
import { CalcomBooking } from './calcom-booking';
import { MockVideo } from './mock-video';
import { DailyVideo } from './daily-video';

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

export function getIdentity(env: AppEnv, db: SupabaseClient): IdentityAdapter {
  switch (env.IDENTITY_IMPL) {
    case 'stripe':
      return new StripeIdentity(env.STRIPE_SECRET_KEY ?? '');
    case 'mock':
    default:
      return new MockIdentity(db);
  }
}

export function getPayments(env: AppEnv, db: SupabaseClient): PaymentsAdapter {
  switch (env.PAYMENTS_IMPL) {
    case 'stripe':
      return new StripePayments(
        env.STRIPE_SECRET_KEY ?? '',
        env.STRIPE_PRICE_CONSULT ?? '',
        env.STRIPE_PRICE_MEMBERSHIP ?? '',
      );
    case 'mock':
    default:
      return new MockPayments(db);
  }
}

export function getBooking(env: AppEnv, db: SupabaseClient): BookingAdapter {
  switch (env.BOOKING_IMPL) {
    case 'calcom':
      return new CalcomBooking(
        env.CALCOM_API_KEY ?? '',
        env.CALCOM_EVENT_TYPE_ID ?? '',
        env.CALCOM_BOOKING_URL ?? '',
      );
    case 'mock':
    default:
      return new MockBooking(db);
  }
}

export function getVideo(env: AppEnv, _db: SupabaseClient): VideoAdapter {
  switch (env.VIDEO_IMPL) {
    case 'daily':
      return new DailyVideo(env.DAILY_API_KEY ?? '', env.DAILY_DOMAIN ?? '');
    case 'mock':
    default:
      return new MockVideo();
  }
}
