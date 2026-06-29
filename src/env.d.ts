/// <reference path="../.astro/types.d.ts" />

import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { AppEnv } from './lib/env';

declare global {
  namespace App {
    // Merges with the Cloudflare adapter's Locals (which provides `runtime`).
    interface Locals {
      env: AppEnv;
      supabase: SupabaseClient;
      user: User | null;
    }
  }
}

export {};
