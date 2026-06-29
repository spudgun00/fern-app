import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .dev.vars into process.env so the Supabase-backed MockCore round-trip
// and readEnv() work in tests, matching how the Cloudflare adapter loads them
// in dev. Existing process.env values win (so CI can override).
try {
  const raw = readFileSync(resolve(process.cwd(), '.dev.vars'), 'utf-8');
  for (const line of raw.split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key] === undefined) {
      process.env[key] = value.replace(/^["']|["']$/g, '');
    }
  }
} catch {
  // .dev.vars not present; rely on the ambient environment.
}
