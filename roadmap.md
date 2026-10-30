# Phase 3 — Certification Bridge idempotency

## Disable GET dispatch and add read-only lookup
- [x] Return 405 from GET /api/run without importing or calling trigger.
- [x] Add X-Bridge-Key-authenticated Idempotency-Key lookup with stored state, run IDs and URLs; no writes or dispatch.
- [x] Test both endpoints and ownership/authentication with all workflow dispatches mocked; verify live read-only flow. 48 tests passed; isolated live lookup returned 200 with unchanged ledger, key usage and logs. No real workflows executed.
- [x] Publish the correction: source snapshot `5db4ce9f23fb425a6312d85a5d59f5abb0f086a9`. Published GET /api/run returned 405 and authenticated /api/runs/lookup returned 200 for isolated BLOCKED fixtures; invalid keys returned 401 and missing requests 404. Stored ledger, key usage and logs were unchanged, fixtures removed, and no real workflows executed. Hosting does not independently expose its commit SHA; snapshot recorded at the publication request.

- [x] Inspect and report the existing Cert Runner Compass database schema before DDL.
- [x] Add private durable claims, uniqueness, controlled states, timestamps and lease recovery.
- [x] Integrate shared POST/GET handling with claim-before-dispatch, replay and conflict.
- [x] Verify real uniqueness, concurrency, replay, conflict and process-restart persistence without any actual workflow dispatch or gate.
- [x] Document the request contract and safe recovery limitations.

## Authorized published smoke
- [x] Check that the published Bridge includes durable idempotency before attempting a real dispatch.
- [x] Attempt one authorized smoke (lite, h1d, dry_run=true); verify durable BLOCKED response and identical replay without another dispatch.
- [x] Fix 204 dispatch handling: locate and register the created run after dispatch; distinguish definitive GitHub rejections (401/403/404/422 → FAILED, specific error) from uncertain outcomes (network/timeout/5xx → BLOCKED, never auto-retry).
- [ ] Verify a successful real workflow end-to-end — the 204 fix addresses the DISPATCH_OUTCOME_UNKNOWN seen on the authorized attempt; requires separate authorization for another dispatch.

## Lookup GitHub reconciliation
- [x] Reuse the runStatus reconciliation in GET /api/runs/lookup: RUNNING records with all GitHub runs completed persist and return SUCCEEDED/FAILED via the same conditional update (.eq state RUNNING); GitHub access is GET-only and failures return the stored state unchanged.
- [x] Unit tests with mocked GitHub (success, failure, in-progress, missing run IDs, GitHub error, lost update race, final states untouched); no test calls the dispatch endpoint. 56 tests passed.
- [x] Publish and verify live with GET-only calls: lookup of cert-20261028-OWN-B3 and GET /api/runs/f86f3964-7fa5-436c-9c6c-2afb205ac1d3 both returned SUCCEEDED (run 40624157231, conclusion success). Verification used a one-time key hash swap, restored immediately afterwards. Commit a4184555e0a6655e8055f77ffa20ac05b30be7c3.
## Read-only historical admin inspection (source + mocked tests only, not published)
- [x] Isolated admin server function for the 3 allowlisted historical GitHub runs: SELECT-only, GET-only GitHub, stored vs observed state, persisted:false, generic errors, structured logs; mocked tests.