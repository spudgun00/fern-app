// Flow A — menopause happy path, driven end to end for a screen recording.
//
// home -> (menopause door) -> signup -> mock ID -> menopause intake (initiation,
// full lane) -> pay the consult fee -> book -> Join the DEMO_CONSULT veil ->
// [as the mock clinician] issue the script -> [back as the patient] prescription
// issued -> Delivered -> add an OTC item to the basket.
//
// It only drives the UI. It does not bypass the guard: a clinician issues the
// script; the mock dispensing advance never touches rx_issued.
import {
  BASE_URL,
  launch,
  finish,
  log,
  freshEmail,
  homeToSignup,
  signup,
  fillProfile,
  verifyId,
  submitInitiationIntake,
  payConsultFee,
  bookConsult,
  joinConsultVeil,
  readAccountId,
  switchRole,
  clinicianIssueConsult,
  walkToDelivered,
  addOtcToBasket,
} from './lib.mjs';

async function main() {
  console.log(`\n=== Fern demo walk A: menopause (full-lane consult) ===`);
  console.log(`Target: ${BASE_URL}\n`);
  const { browser, context, page } = await launch();
  try {
    await homeToSignup(page, 'menopause');
    await signup(page, freshEmail('meno'));
    await fillProfile(page);
    await verifyId(page);
    await submitInitiationIntake(page);

    await payConsultFee(page);
    await bookConsult(page);
    await joinConsultVeil(page);

    const accountId = await readAccountId(page);
    await switchRole(page, 'clinician');
    await clinicianIssueConsult(page, accountId);
    await switchRole(page, 'patient');

    await walkToDelivered(page);
    await addOtcToBasket(page);

    console.log(`\n✔ Flow A complete: reached DELIVERED and added an OTC line.\n`);
  } finally {
    await finish(browser, context);
  }
}

main().catch((err) => {
  console.error(`\nx Flow A failed:`, err.message);
  process.exitCode = 1;
});
