// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// Fern patient zone (authenticated app). Server-rendered on Cloudflare Workers.
// Auth, secrets, and per-user data live in THIS repo only; the marketing site
// stays static and untouched (see docs/fern-patient-zone-build-spec.md).
export default defineConfig({
  output: 'server',
  // P0 has no images; passthrough avoids requiring the Cloudflare Images binding.
  adapter: cloudflare({ imageService: 'passthrough' }),
});
