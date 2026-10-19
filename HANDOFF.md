# Handoff: Designer Parity Tool

Standalone project (must NOT live inside symon-ai/app). Code is in this folder.

## Goal
Compare two mostly-identical Designer models (orgID + env). For pipes whose pipeID AND name match,
and elements whose elementID AND name match, compare Preview and Last Run row counts. Output a
Parity Report (pipeName, pipeID, element, Yes/No, counts for A/B + delta when No). Unmatched items
are excluded.

## Done
- CLI in `src/` (Node 22.6+, `node --experimental-strip-types src/index.ts --config parity.json`).
- ELT endpoints: `GET /pipes`, `GET /pipes/{id}/elements/v2` (paged), `GET /results/fast-count`
  (`requestType=sample` = Preview, `pipe` = Last Run/Last Calc), org via `wisepipe-org-id` header.
- Env -> ELT API: designer-dev/designer-daily (release2.spmdev.varicent.com) -> https://daily-api.wisepipe.com;
  designer-staging (preview-staging.spmdev.varicent.com) -> https://qa-staging-elt-api.varicent.com.
- Verified with a mocked API (matching, pagination, 401 re-login, report).

## Blocker
Auth is wrong: `src/authH.ts` logs in via ELT Cognito, but the users are Designer (ICM) users.
Designer logs in itself, then its API returns an ELT token via `GET symon/jwttoken` (v1; also
`symon/token`), which ELT accepts as `Authorization: BearerCustomJwt <token>` (see
api/auth/service/src/userService.ts in symon-ai/app; it is minted by ELT `GET /auth/jwtLoginToken`).

## Next steps
1. Read jjwuv/api-test-automation to see how it logs in to Designer (URL, body, token/cookie).
2. Replace the login in `src/authH.ts`: Designer login -> `symon/jwttoken` -> use as
   `BearerCustomJwt` in `src/apiClientH.ts`.
3. Run against the two test orgs (credentials are given by the user in chat; never commit them):
   - A: org e71de6f3-4b2c-44c8-a9bb-9a52cc22a797, designer-daily, model BMRNProdDesigner0716
   - B: org 9eacbaed-2343-4563-b5bd-42d0d4b17691, designer-staging, model BMRNProdDesigner0716
4. Deliver the project for /Users/jjwu/workspace (e.g. push to a new empty GitHub repo).

Note: repeated ELT Cognito attempts caused "Password attempts exceeded" for jjwu@varicent.com on the
ELT qa-staging pool; avoid more ELT-Cognito attempts.

## Update (auth implemented)
- Auth now matches the Designer UI (see README). Verified on designer-staging: login -> jwttoken -> /pipes -> fast-count OK,
  full self-compare run of org 9eacbaed... produced a 3669-row report.
- Org 9eacbaed-2343-4563-b5bd-42d0d4b17691 is model `SmokeBMRNProdJul16` on staging (not BMRNProdDesigner0716,
  which jjwu@varicent.com cannot access there).
- designer-daily login for jj@eltautomation returns 403 "incorrect email or password" (it is likely an ELT user, not a Designer user).
- Auth switched to Designer API key only (PARITY_<ENV>_APIKEY), matching api-test-automation; password login removed.
