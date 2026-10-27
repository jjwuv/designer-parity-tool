# Designer Parity Tool

Compares two mostly-identical Designer models (ELT orgs) and reports, per element, whether the
**Preview** and **Last Run** row counts match.

- Pipes are compared only when the `pipeID` **and** name match in both models; elements likewise
  (`elementID` and name). Anything unmatched is left out of the report.
- Elements with no Preview and no Last Run count in either model are not mismatches. They are left out
  of the main table and listed in a second table, "Tools not found in either model", below it.
- Parity is `Yes` when both Preview and Last Run counts exist and are equal. Edge case: if Preview is
  N/A in both models but Last Run exists and is equal, parity is also `Yes`. For `No` rows the counts
  for A and B and the results columns (`previewResults` / `lastRunResults`, B - A) are included; `N/A` means the element has never been
  previewed/run on that side. Preview counts stop at 10,000 (shown as `10,000+`); when only one side is capped,
  `previewResults` shows a bound such as `≤ -1572`, and when both are capped the Preview counts match.
- Both models can live in the same env or in different ones.
- The report is an HTML file listing only elements whose row counts
  differ. Only the mismatching cells (Preview and/or Last Run) are highlighted red.
- A "Models Compared" table at the top shows env, model name and org IDs for A vs B, calculations
  compared (distinct `pipeID`s), and total elements compared (with tools in / not in parity). The
  generation date and the tool's git branch and commit follow it.
- The terminal shows the models being compared and pipe/element counts; `save` also prints a line as each
  pipe finishes.
- Rows are sorted by `pipeID`, then element name, so all elements of a pipe are grouped together.

## Requirements

Node 22.6+ (runs TypeScript directly via `--experimental-strip-types`; no install step).

## Usage

```bash
cd designer-parity-tool
export designerParityModel1_apikey='...'   # key for model A
export designerParityModel2_apikey='...'   # key for model B
npm run designer-parity-tool
```

This reads `model-details.json` (copy `model-details.example.json`) and writes the report to a new folder
per run, so earlier reports are kept:

- Two-model run: `reports/two/<orgID of model A>/<YYYY-MM-DD_HHMMSS>/parity-report.html`
- Single-model `compare`: `reports/single/<orgID>/<YYYY-MM-DD_HHMMSS>/parity-report.html`

Extra options go after `--`; `--out other-report.html` writes to that exact path instead. To use a different
model details file: `npm start -- --config other.json`.

Or with one file per model: `--a modelA.json --b modelB.json`. `--concurrency` (default 2, max 4) limits
parallel API calls per step.

Target fields: `orgID`, `env` (`designer-daily` | `designer-staging`), `modelName`
(the Designer model, sent as the `Model` header).

## Single-model mode

When you don't have two identical models, save one model's row counts before and after a change, then
compare the two saved files:

```bash
export designerParityModel1_apikey='...'

# Before the change (e.g. engine mode Hybrid)
npm run designer-parity-tool -- save --label Hybrid --out snapshots/hybrid.json

# Make the change in Designer and rerun the calculations, then:
npm run designer-parity-tool -- save --label Big --out snapshots/big.json

# Build the report from the two files (no API calls, no key needed)
npm run designer-parity-tool -- compare snapshots/hybrid.json snapshots/big.json
```

- `save` reads one model from `model-details-single.json` (copy `model-details-single.example.json`):
  `{ "orgID", "env", "modelName" }`, with no `a`/`b`. It uses `designerParityModel1_apikey`. Use
  `--config other.json` for a different file. `--label` and `--out` are required.
- By default `save` reads the stored Preview and Last Run counts without regenerating any samples, so it is
  fast. Stored Preview samples can be stale, so the report notes that Preview mismatches may be stale.
  `--concurrency` (1 to 4) controls how many elements run at once.
- `save --refresh-previews` regenerates each previewed element's sample before reading it, as a live run does
  for mismatches. This is much slower (about 1.5 hours for ~1,800 elements at concurrency 2). Elements with no
  stored Preview count (never previewed) are not regenerated, and `save` prints how many were skipped. Failed
  refreshes are recorded in the file and shown in the report.

  ```bash
  npm run designer-parity-tool -- save --label Hybrid --out snapshots/hybrid.json --refresh-previews
  ```
- `save --last-run-only` skips Preview entirely. If either snapshot was saved this way, `compare` checks Last
  Run counts only and the report marks Preview as "Not compared".

  ```bash
  npm run designer-parity-tool -- save --label Hybrid --out snapshots/hybrid.json --last-run-only
  ```
- `compare` uses the same matching, parity rules and report as a live run. The header shows each snapshot's
  label and save time instead of the engine mode. It warns if the two snapshots are from different models.
- Snapshot files never contain the API key. `snapshots/` is gitignored.

## Stale sample check

Preview counts are read from a stored `sample_rowcount` file, which can be missing or stale (a missing file
falls back to the Last Calc count). So when the Preview counts of A and B **differ**, the tool regenerates
both samples the way the UI does (`POST /computations/samples`, poll `GET /computations/samples/{id}`, then
delete it) and re-reads the Preview counts. Elements whose Preview counts already match (or are both capped
or both N/A) are not refreshed. There are no flags for this; failures or timeouts are summarized at the end
and those rows may still be stale.

## Authentication

Same as api-test-automation's `DesignerLib`: a Designer API key per model.
`GET {designerApi}/api/v1/symon/jwttoken` with `Authorization: Bearer <APIKEY>` and `Model: <modelName>`
returns `{token, orgID, apiUrl}`; ELT calls go to `apiUrl` with `Authorization: BearerCustomJwt <token>`.
The returned orgID must equal the target's `orgID`.

Keys come only from environment variables: `designerParityModel1_apikey` for model A and
`designerParityModel2_apikey` for model B, whatever their env. Both are required for a two-model run
(`save` needs only `designerParityModel1_apikey`); an `apiKey` in a config
file is ignored.

## Environments

| env                           | Designer API                                  | ELT API                                 |
| ----------------------------- | --------------------------------------------- | --------------------------------------- |
| designer-daily                | https://api.release2.spmdev.varicent.com      | https://daily-api.wisepipe.com          |
| designer-staging              | https://api.preview-staging.spmdev.varicent.com | https://qa-staging-elt-api.varicent.com |

Add more in `src/parityToolF.ts`.

## Endpoints used

- `GET /pipes`: pipes in the org
- `GET /pipes/{pipeID}/elements/v2`: elements (paged)
- `GET /results/fast-count?requestType=sample|pipe`: Preview / Last Run row counts
