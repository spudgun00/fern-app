import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts'],
    // The Supabase-backed MockCore round-trip hits the network.
    testTimeout: 30_000,
  },
});
