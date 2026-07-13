// Shared helpers for the deterministic, human-paced demo walk scripts
// (menopause.mjs + weight.mjs). These drive the REAL Fern UI end to end for a
// screen recording: every step is a click/type on the actual pages, never a
// direct DB write. The only "demo" endpoints they use are the same mock-only
// reviewer affordances the demo panel exposes (role switch, advance dispensing,
// advance screening) — none of which bypasses the clinical guard: a clinician
// still issues every script, and screening only advances as a real lab would.
//
// Config (all via env):
//   BASE_URL   target origin (default: the deployed demo)
//   HEADLESS   "1"/"true" to run headless (default: headed, for recording)
//   PACE       ms to pause between steps so the walk is watchable (default 1400)
//   SLOWMO     Playwright slowMo ms per action (default 200)
//   RECORD_DIR if set, save a .webm video of the run into this directory
//   PREVIEW_PASS  if the target is behind the shared *.fern.care preview gate
import { chromium } from 'playwright';

export const BASE_URL = (process.env.BASE_URL || 'https://fern-app.jimgill.workers.dev').replace(/\/$/, '');
export const HEADLESS = process.env.HEADLESS === '1' || process.env.HEADLESS === 'true';
export const PACE = Number(process.env.PACE || 1400);
export const SLOWMO = Number(process.env.SLOWMO || 200);
const RECORD_DIR = process.env.RECORD_DIR || '';
const PREVIEW_PASS = process.env.PREVIEW_PASS || '';

let step = 0;
export function log(msg) {
  step += 1;
  const t = new Date().toISOString().slice(11, 19);
  console.log(`  [${t}] ${String(step).padStart(2, '0')}. ${msg}`);
}

// A deliberate, human-paced beat so the recording is watchable.
export async function beat(page, ms) {
  await page.waitForTimeout(ms ?? PACE);
}

export async function launch() {
  const browser = await chromium.launch({
    headless: HEADLESS,
    slowMo: SLOWMO,
    args: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ...(RECORD_DIR ? { recordVideo: { dir: RECORD_DIR, size: { width: 1280, height: 900 } } } : {}),
  });
  const page = await context.newPage();
  return { browser, context, page };
}

// A throwaway, unique email per run so signup never collides.
export function freshEmail(tag) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `demo-${tag}-${Date.now()}-${rand}@example.com`;
}

// Click a control and wait until we land on the expected URL glob.
export async function clickTo(page, locator, glob) {
  await Promise.all([
    page.waitForURL(glob, { timeout: 45000, waitUntil: 'domcontentloaded' }),
    locator.click(),
  ]);
}

// Click a control whose POST redirects back to the SAME url (advance-* / role):
// waitForURL would match instantly, so wait for the actual navigation instead.
export async function submitReload(page, locator) {
  await Promise.all([
    page.waitForNavigation({ timeout: 45000, waitUntil: 'domcontentloaded' }),
    locator.click(),
  ]);
}

// If the target sits behind the shared preview gate, enter the password once.
export async function passGateIfPresent(page) {
  if (!/\/gate(\?|$)/.test(page.url())) return;
  if (!PREVIEW_PASS) {
    throw new Error('Hit the preview gate but PREVIEW_PASS is not set.');
  }
  log('Preview gate: entering the shared password');
  await page.fill('input[name="password"]', PREVIEW_PASS);
  await submitReload(page, page.locator('button[type="submit"]'));
  await beat(page);
}

// ---- onboarding ---------------------------------------------------------

// home -> the chosen front door CTA -> /signup. door: 'menopause' | 'weight'.
export async function homeToSignup(page, door) {
  log(`Open the Fern home page`);
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await passGateIfPresent(page);
  await beat(page);
  const label = door === 'weight' ? 'Start your assessment' : 'Start your health screen';
  log(`Enter via the ${door} front door ("${label}")`);
  await clickTo(page, page.getByRole('link', { name: label }).first(), '**/signup**');
  await beat(page);
}

export async function signup(page, email) {
  log(`Create an account (${email})`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', 'Demo-Passw0rd!');
  await clickTo(page, page.getByRole('button', { name: 'Create account' }), '**/account/profile**');
  await beat(page);
}

export async function fillProfile(page) {
  log('Fill the profile + GP details, consent to GP sharing');
  await page.fill('input[name="fullName"]', 'Priya Anand');
  await page.fill('input[name="dateOfBirth"]', '1975-06-15');
  await page.fill('input[name="contact"]', '07700 900123');
  await page.fill('input[name="gpPractice"]', 'Elm Tree Surgery');
  await page.check('input[name="gpDecision"][value="consent"]');
  await clickTo(
    page,
    page.getByRole('button', { name: 'Save and continue to ID check' }),
    '**/account/verify**',
  );
  await beat(page);
}

export async function verifyId(page) {
  log('Start the ID check');
  await clickTo(page, page.getByRole('button', { name: 'Start ID check' }), '**/account/verify/mock**');
  await beat(page);
  log('Complete the mock ID check (Demo stand-in)');
  await clickTo(
    page,
    page.getByRole('button', { name: 'Complete verification' }),
    '**/account/verify/complete**',
  );
  await beat(page);
  log('Identity verified -> continue to intake');
  await clickTo(page, page.getByRole('link', { name: 'Continue to intake' }), '**/intake**');
  await beat(page);
}

// Fill the menopause questionnaire as a first-time initiation with an otherwise
// clean picture -> the assessed (full) lane (intake_submitted). All risk +
// red-flag answers are "no".
export async function submitInitiationIntake(page) {
  log('Answer the health questions (first-time initiation, no red flags) -> full lane');
  await page.check('input[name="treatmentHistory"][value="initiation"]');
  // A symptom or two for realism (checkboxes are optional).
  const firstSymptom = page.locator('input[name="symptoms"]').first();
  if (await firstSymptom.count()) await firstSymptom.check();
  await page.fill('input[name="monthsSinceLastPeriod"]', '14');
  await page.fill('input[name="bpSystolic"]', '122');
  await page.fill('input[name="bpDiastolic"]', '78');
  for (const name of [
    'clotHistory',
    'breastCancerHistory',
    'liverDisease',
    'unexplainedBleeding',
    'currentPregnancy',
    'suspectedClotSymptoms',
    'undiagnosedBreastLump',
  ]) {
    await page.check(`input[name="${name}"][value="no"]`);
  }
  await clickTo(page, page.getByRole('button', { name: 'Submit intake' }), '**/intake**');
  await beat(page);
}

// ---- payments (mock checkout) ------------------------------------------

// Pay the consultation fee via the mock checkout (the "test card" stand-in on the
// keyless demo). Lands back on the billing complete page.
export async function payConsultFee(page) {
  log('Go to billing and pay the consultation fee (mock checkout)');
  await page.goto(`${BASE_URL}/account/billing`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await beat(page);
  await clickTo(
    page,
    page.getByRole('button', { name: /Pay the consultation fee/ }),
    '**/account/billing/mock**',
  );
  await beat(page);
  log('Complete the mock payment (no card details are entered or stored)');
  await clickTo(
    page,
    page.getByRole('button', { name: 'Complete payment' }),
    '**/account/billing/complete**',
  );
  await beat(page);
}

// Pay for a checkout product (e.g. weight_treatment / menopause_screen) on the
// shared /checkout surface, consenting first. Lands on the checkout complete page.
export async function payForProduct(page, product) {
  log(`Open the checkout for "${product}" and consent`);
  await page.goto(`${BASE_URL}/checkout?product=${product}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await beat(page);
  await page.check('input[name="consent"]');
  await beat(page, 600);
  log('Pay (mock checkout)');
  await clickTo(page, page.getByRole('button', { name: /^Pay / }), '**/account/billing/mock**');
  await beat(page);
  log('Complete the mock payment');
  await clickTo(page, page.getByRole('button', { name: 'Complete payment' }), '**/checkout/complete**');
  await beat(page);
}

// ---- screening (mock lab advance) --------------------------------------

// Step the mock at-home screen forward on /screening (kit posted -> sample
// received -> results released). Two "Advance the screen (demo)" clicks. This is
// the mock stand-in for the lab callback; it advances the screen to results_ready
// EXACTLY as a real lab would (it does not bypass the guard) and routes the
// screened patient to the assessed consult lane.
export async function advanceScreening(page) {
  for (let i = 1; i <= 2; i += 1) {
    await page.goto(`${BASE_URL}/screening`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await beat(page);
    const btn = page.getByRole('button', { name: 'Advance the screen (demo)' });
    if (!(await btn.count())) break; // already results_ready
    log(`Advance the mock screen (step ${i}/2)`);
    await submitReload(page, btn);
    await beat(page);
  }
  log('Screen results are in (baseline saved) -> a clinician can now decide');
}

// ---- booking + the consult veil ----------------------------------------

export async function bookConsult(page) {
  log('Go to the consultation surface and book a slot');
  await page.goto(`${BASE_URL}/consult`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await beat(page);
  await clickTo(page, page.getByRole('button', { name: 'Book your consult' }), '**/consult/book/mock**');
  await beat(page);
  log('Choose a consultation slot (Demo stand-in scheduler)');
  await page.locator('input[type="radio"]').first().check();
  await beat(page, 600);
  await clickTo(
    page,
    page.getByRole('button', { name: 'Confirm booking' }),
    '**/consult/book/complete**',
  );
  await beat(page);
}

// Join the consult and walk the DEMO_CONSULT veil: state 1 (the call is taking
// place, with the booking detail) -> Continue -> state 2 (the clinician is
// reviewing). Leaves the patient at the awaiting-decision state.
export async function joinConsultVeil(page) {
  log('Return to the consultation and Join the video consultation');
  await page.goto(`${BASE_URL}/consult`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await beat(page);
  const joinLink = page.getByRole('link', { name: 'Join the video consultation' });
  const href = await joinLink.getAttribute('href');
  if (href !== '/consult/veil') {
    throw new Error(`Join did not route to the veil (href=${href}). Is DEMO_CONSULT on?`);
  }
  await clickTo(page, joinLink, '**/consult/veil**');
  await beat(page);
  log('Veil state 1: "Your video consultation is taking place" (with the booking detail)');
  await beat(page, PACE + 1200);
  log('Advance the veil -> state 2: "Your consultation is complete" (happy to prescribe)');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('Your consultation is complete').waitFor({ timeout: 15000 });
  await beat(page, PACE + 800);
}

// ---- the reviewer console (mock clinician) -----------------------------

// Read the current account id (used to find this patient's own card in the global
// clinician queue). Fetched from /demo via the page's request context so it does
// NOT navigate the visible page — the /demo reviewer panel never appears in a
// recording.
export async function readAccountId(page) {
  const html = await page.request.get(`${BASE_URL}/demo`).then((r) => r.text());
  const m = html.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (!m) throw new Error('Could not read the account id from /demo');
  return m[0];
}

// Switch the account's role via the demo endpoint directly (not the visible /demo
// panel), so the reviewer scaffolding stays out of the recording. The POST shares
// the page session cookie, so the visible page's next navigation reflects the new
// role. An Origin header satisfies the app's CSRF check.
export async function switchRole(page, role) {
  log(`Switch role -> ${role} (one account, two roles)`);
  const res = await page.request.post(`${BASE_URL}/api/demo/role`, {
    form: { role, return: '/' },
    headers: { origin: BASE_URL },
  });
  if (res.status() >= 400) {
    throw new Error(`Role switch to ${role} failed (HTTP ${res.status()})`);
  }
  await beat(page, 500);
}

// As the clinician: open THIS patient's consult from the queue and Issue the
// script (the guard is satisfied; a clinician makes the decision). accountId is
// used to pick our own card out of the global queue (its 8-char ref pill).
export async function clinicianIssueConsult(page, accountId) {
  const prefix = accountId.slice(0, 8);
  log(`Open the consult queue and find this patient's consult (${prefix})`);
  await page.goto(`${BASE_URL}/clinician/consults`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await beat(page);
  const card = page.locator('a.qrow', { hasText: prefix }).first();
  await card.waitFor({ timeout: 15000 });
  await clickTo(page, card, '**/clinician/consult/**');
  await beat(page);
  log('Record the clinical reason and Issue the script (the clinician decides)');
  await page.fill('textarea[name="reason"]', 'Assessed at consultation; suitable to initiate, no contraindications.');
  await beat(page, 700);
  await submitReload(page, page.getByRole('button', { name: 'Issue script' }));
  await beat(page);
}

// ---- treatment -> delivered + OTC basket --------------------------------

// C5 (Journey F): with the purchase funnel on + per-fill medication billing (the
// deployed demo's config), a clinician-issued script waits for the patient to
// confirm + pay for their medication before it is dispensed. If the treatment
// page shows the "Confirm your medication" step, pay it (mock checkout) so
// dispensing starts. A no-op under bundled billing (dispensing proceeds inline).
export async function confirmMedicationIfNeeded(page) {
  await page.goto(`${BASE_URL}/treatment`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await beat(page);
  const confirm = page.getByRole('link', { name: 'Confirm your medication' });
  if (!(await confirm.count())) return; // bundled / not deferred -> nothing to pay
  log('Confirm + pay for the medication (Journey F, pass-through dispensing charge)');
  await clickTo(page, confirm, '**/checkout**');
  await beat(page);
  await page.check('input[name="consent"]');
  await beat(page, 600);
  await clickTo(page, page.getByRole('button', { name: /^Pay / }), '**/account/billing/mock**');
  await beat(page);
  await clickTo(page, page.getByRole('button', { name: 'Complete payment' }), '**/checkout/complete**');
  await beat(page);
}

// Back as the patient: confirm the prescription reached the pharmacy, then step
// the mock dispensing forward to Delivered (the same demo affordance the panel
// exposes; it never touches rx_issued).
export async function walkToDelivered(page) {
  await confirmMedicationIfNeeded(page);
  log('Open Treatment (prescription issued, sent to the pharmacy)');
  await page.goto(`${BASE_URL}/treatment`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await beat(page);
  await page.getByText('Your current prescription').waitFor({ timeout: 15000 });
  for (let i = 1; i <= 3; i += 1) {
    const advance = page.getByRole('button', { name: 'Advance dispensing status' });
    if (!(await advance.count())) break; // delivered -> control hidden
    log(`Advance the mock dispensing (step ${i})`);
    await submitReload(page, advance);
    await beat(page);
  }
  await page.getByText('Delivered', { exact: false }).first().waitFor({ timeout: 15000 });
  log('Treatment delivered ✔');
  await beat(page);
}

// Add the first available OTC item to the basket, then show the basket.
export async function addOtcToBasket(page) {
  log('Browse the shop and add an over-the-counter item to the basket');
  await page.goto(`${BASE_URL}/shop`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await beat(page);
  const otcAdd = page.locator('form:has(input[name="type"][value="otc"]) button[type="submit"]').first();
  await otcAdd.waitFor({ timeout: 15000 });
  await submitReload(page, otcAdd);
  await beat(page);
  log('Open the basket (the OTC line, ready to check out)');
  await page.goto(`${BASE_URL}/cart`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await beat(page, PACE + 800);
}

export async function finish(browser, context) {
  await context.close();
  await browser.close();
}
