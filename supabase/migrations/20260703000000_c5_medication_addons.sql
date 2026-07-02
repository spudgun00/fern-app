-- Fern patient zone — checkout C5: medication payment (Journey F) + add-ons (Journey G).
--
-- Journey F (medication) is a PASS-THROUGH charge (CloudRx model) for the POM the
-- clinician already prescribed: it pays for DISPENSING, it does NOT prescribe. It
-- reuses the P0 payment_ref pointer table (provider pointer + coarse status only),
-- adding one payment_kind so it is not conflated with the screen/consult/treatment
-- charges. Journey G add-ons are two more pointer kinds: a one-off side-effect
-- support kit ('addon_kit') and a recurring 6/12-month re-screen ('rescreen',
-- reusing the screen product's framing).
--
-- Additive enum values only; no table change. payment_ref.kind is the payment_kind
-- enum, so each new charge kind is added here before it can be recorded. No card
-- data, no PII, no Article 9 clinical content — the same hard line as P5/C2/C4.
--
-- HARD LINE (restated): none of these charges is a predecessor of rx_issued. The
-- medication charge gates rx_issued -> dispensing only; the script already exists
-- from the clinician action. RX_ISSUED_PREDECESSORS stays {approved, consult_done}.
alter type payment_kind add value if not exists 'medication';
alter type payment_kind add value if not exists 'addon_kit';
alter type payment_kind add value if not exists 'rescreen';
