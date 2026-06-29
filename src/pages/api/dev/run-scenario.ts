import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase/admin';
import { runHarnessScenario } from '../../../lib/scenario';

function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Runs the scenario server-side and renders an unstyled trace page.
export const POST: APIRoute = async (ctx) => {
  const { user, env } = ctx.locals;
  if (!user) return ctx.redirect('/login');

  const admin = createAdminClient(env);

  let body: string;
  try {
    const result = await runHarnessScenario(env, admin, user.id, { email: user.email });
    const traceRows = result.trace
      .map((s) => `<li><strong>${esc(s.step)}</strong>: ${esc(s.detail)}</li>`)
      .join('\n');

    body = `
      <h1>Scenario trace</h1>
      <p>Ran end to end through the adapters (CORE_IMPL=${esc(env.CORE_IMPL)}) and the state machine.</p>
      <ol>${traceRows}</ol>
      <h2>Result</h2>
      <ul>
        <li>account id: <code>${esc(result.accountId)}</code></li>
        <li>core_patient_id: <code>${esc(result.corePatientId)}</code></li>
        <li>intake id: <code>${esc(result.intakeId)}</code></li>
        <li>final journey state: <code>${esc(result.journeyState)}</code></li>
        <li>lane: <code>${esc(result.lane)}</code></li>
        <li>intake read back: <code>${esc(JSON.stringify(result.intakeReadBack))}</code></li>
      </ul>
      <p><a href="/dev/harness">Back to harness</a></p>
    `;
  } catch (err) {
    body = `
      <h1>Scenario failed</h1>
      <pre style="color: red; white-space: pre-wrap">${esc(err instanceof Error ? (err.stack ?? err.message) : String(err))}</pre>
      <p><a href="/dev/harness">Back to harness</a></p>
    `;
  }

  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Scenario trace</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${body}</body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
};
