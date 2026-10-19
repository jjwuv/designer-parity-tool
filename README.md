# Designer Parity Tool

Compares two mostly-identical Designer models (ELT orgs) and reports, per element, whether the
**Preview** and **Last Run** row counts match.

- Pipes are compared only when the `pipeID` **and** name match in both models; elements likewise
  (`elementID` and name). Anything unmatched is left out of the report.
- Parity is `Yes` when both Preview and Last Run counts exist and are equal. For `No` rows the counts
  for A and B and the deltas (B - A) are included; `N/A` means the element has never been
  previewed/run on that side.
- Both models can live in the same env or in different ones.

## Requirements

Node 22.6+ (runs TypeScript directly via `--experimental-strip-types`; no install step).

## Usage

```bash
cd designer-parity-tool
export PARITY_DESIGNER_DAILY_APIKEY='...'
export PARITY_DESIGNER_STAGING_APIKEY='...'
node --experimental-strip-types src/index.ts --config parity.example.json --out parity-report.csv
```

Or with one file per model: `--a modelA.json --b modelB.json`. `--concurrency` (default 5) limits
parallel API calls per step.

Target fields: `orgID`, `env` (`designer-dev` | `designer-daily` | `designer-staging`), `modelName`
(the Designer model, sent as the `Model` header), and optionally `apiKey`.

## Authentication

Same as api-test-automation's `DesignerLib`: a Designer API key per env.
`GET {designerApi}/api/v1/symon/jwttoken` with `Authorization: Bearer <APIKEY>` and `Model: <modelName>`
returns `{token, orgID, apiUrl}`; ELT calls go to `apiUrl` with `Authorization: BearerCustomJwt <token>`.
The returned orgID must equal the target's `orgID`.

Set `PARITY_DESIGNER_DAILY_APIKEY` / `PARITY_DESIGNER_STAGING_APIKEY` (global fallback `PARITY_APIKEY`), or
`apiKey` in the target config (don't commit it).

## Environments

| env                           | Designer API                                  | ELT API                                 |
| ----------------------------- | --------------------------------------------- | --------------------------------------- |
| designer-dev / designer-daily | https://api.release2.spmdev.varicent.com      | https://daily-api.wisepipe.com          |
| designer-staging              | https://api.preview-staging.spmdev.varicent.com | https://qa-staging-elt-api.varicent.com |

Add more in `src/parityToolF.ts`.

## Endpoints used

- `GET /pipes`: pipes in the org
- `GET /pipes/{pipeID}/elements/v2`: elements (paged)
- `GET /results/fast-count?requestType=sample|pipe`: Preview / Last Run row counts
