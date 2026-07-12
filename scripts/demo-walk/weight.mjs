// Flow B — weight / metabolic happy path (the screening-led shape), driven end to
// end for a screen recording.
//
// home -> (weight door) -> signup -> mock ID -> intake (initiation, full lane) ->
// pay for the weight programme on /checkout (orders the at-home screen) ->
// advance the mock screen to results-ready -> pay the consult fee -> book ->
// Join the DEMO_CONSULT veil -> [as the mock clinician] issue the script ->
// [back as the patient] prescription issued -> Delivered -> add an OTC item.
//
// It only drives the UI and does not bypass the guard: the screen advances only
// as a real lab would (which is what flips the guard to "allowed"), and a
// clinician still issues the script.
import {
  BASE_URL,
  launch,
  finish,
  freshEmail,
  homeToSignup,
  signup,
  fillProfile,
  verifyId,
  submitInitiationIntake,
  payForProduct,
  advanceScreening,
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
  console.log(`\n=== Fern demo walk B: weight / metabolic (screening-led) ===`);
  console.log(`Target: ${BASE_URL}\n`);
  const { browser, context, page } = await launch();
  try {
    await homeToSignup(page, 'weight');
    await signup(page, freshEmail('weight'));
    await fillProfile(page);
    await verifyId(page);
    await submitInitiationIntake(page);

    // Pay for the weight programme -> orders the at-home Midlife Health Screen.
    await payForProduct(page, 'weight_treatment');
    // The mock lab reports (advances to results-ready) -> routes to the consult.
    await advanceScreening(page);

    // The assessed consult (paid, booked, joined via the veil).
    await payConsultFee(page);
    await bookConsult(page);
    await joinConsultVeil(page);

    const accountId = await readAccountId(page);
    await switchRole(page, 'clinician');
    await clinicianIssueConsult(page, accountId);
    await switchRole(page, 'patient');

    await walkToDelivered(page);
    await addOtcToBasket(page);

    console.log(`\n✔ Flow B complete: reached DELIVERED and added an OTC line.\n`);
  } finally {
    await finish(browser, context);
  }
}

main().catch((err) => {
  console.error(`\nx Flow B failed:`, err.message);
  process.exitCode = 1;
});
