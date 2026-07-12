# Demo walk scripts (Playwright)

Two deterministic, human-paced Playwright scripts that drive the **real Fern UI**
end to end for a screen recording. They click and type on the actual pages — they
do **not** write to the database directly and they do **not** bypass the clinical
guard (a clinician still issues every script; the mock screen advances only as a
real lab would).

- `menopause.mjs` — **flow A**: home → (menopause door) → signup → mock ID →
  menopause intake (initiation → full lane) → pay the consult fee → book → **Join
  the DEMO_CONSULT veil** → [as the mock clinician] issue → [back as patient]
  prescribed → **Delivered** → add an OTC item to the basket.
- `weight.mjs` — **flow B**: home → (weight door) → signup → mock ID → intake →
  pay the weight programme (orders the at-home screen) → **advance the mock
  screen to results-ready** → pay the consult fee → book → **Join the veil** →
  issue → prescribed → **Delivered** → add an OTC item.

## Run

```sh
npm run demo:menopause      # flow A
npm run demo:weight         # flow B
```

By default they target the deployed demo (`BASE_URL` below) in a **headed**
browser at a watchable pace, ideal for screen recording.

### Config (env)

| var           | default                                   | meaning                                        |
| ------------- | ----------------------------------------- | ---------------------------------------------- |
| `BASE_URL`    | `https://fern-app.jimgill.workers.dev`    | target origin                                  |
| `HEADLESS`    | _(off)_                                   | `1` to run headless (CI / quick proof)         |
| `PACE`        | `1400`                                    | ms paused between steps (watchability)         |
| `SLOWMO`      | `200`                                     | Playwright slowMo ms per action                |
| `RECORD_DIR`  | _(off)_                                   | save a `.webm` of the run into this dir        |
| `PREVIEW_PASS`| _(off)_                                   | shared preview-gate password, if the target is gated |

Examples:

```sh
# Record flow A against the deployed demo
RECORD_DIR=./recordings npm run demo:menopause

# Quick headless proof against a local dev server
BASE_URL=http://localhost:4321 HEADLESS=1 PACE=250 SLOWMO=0 npm run demo:weight
```

## Requirements the target must satisfy

The demo/preview these drive against must have the demo flags on, specifically:

- `PURCHASE_ENABLED=true`, `WEIGHTLOSS_RX_ENABLED=true` (the front-door CTAs +
  the weight checkout product),
- `DEMO_CONSULT=true` (the Join veil — flow A/B assert Join routes to it),
- `OTC_SHOP_ENABLED=true` with at least one `OTC_CATEGORIES` id (the OTC basket
  step),
- mock adapters (`*_IMPL=mock`, the keyless default) so the mock checkout /
  scheduler / lab / dispensing affordances are present.

> Note: at the time these were written the **deployed** demo did not yet have the
> DEMO_CONSULT veil (undeployed). They were proven against a local dev server with
> the flags above; the deployed target picks them up once that build is deployed.
