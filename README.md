# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS

## Certification Bridge — durable idempotency (Phase 3)

Storage is the Cert Runner Compass Lovable Cloud database. No external database or Render API is used.

### Request contract

POST `/api/runs`: `X-Bridge-Key` plus required `Idempotency-Key` (or JSON `idempotency_key`). Accepts `target_repo`, `gate`, `dry_run`, optional `validation_id`, `correlation_id`, `branch`, and `requested_sha`. GET `/api/run` is disabled and always returns 405 `METHOD_NOT_ALLOWED`; it never calls `trigger()`.

GET `/api/runs/lookup`: requires **both headers** `X-Bridge-Key` and `Idempotency-Key` (no query-string credentials). Returns the stored `idempotency_id`, `state`, `outcome_state`, Bridge `run_id`, `status_url`, GitHub `runs` (repository, run ID, `html_url`), `job_ids`, `error_code` and `updated_at`. IDs/URL are null or empty before registration. This is a strictly read-only snapshot: no claim/replay, lease changes, last-used update, logging write, GitHub call or dispatch. State reflects the last persisted reconciliation, not a fresh GitHub poll. Missing/invalid authentication returns 401; missing/invalid Idempotency-Key returns 400; missing records or records owned by another bridge key return the same 404; unavailable storage returns 503.

- `validation_id` and `correlation_id` default to the idempotency key. `branch` defaults to the configured reference or `main`; a supplied full `requested_sha` is the exact dispatch reference.
- The fingerprint includes normalized target, gate, boolean dry_run, validation/correlation IDs, branch and requested SHA. It excludes credentials. IDs are safe identifiers, not freeform secret-bearing metadata.
- Same key and fingerprint returns the stored HTTP status and receipt, without dispatch. A different fingerprint (or bridge credential owner) returns 409 `IDEMPOTENCY_CONFLICT` without disclosing another owner's result.
- Missing key returns 400; unavailable durable claim returns 503 and no workflow starts. A live claim returns 202; leases last two minutes. New explicit keys intentionally request new operations; the old five-minute parameter dedupe is replaced by durable key-based identity.

### Recovery and lifecycle

A run row is stored transactionally before dispatch. Every repository dispatch intent and accepted run ID is stored durably. Expired leases before any intent may be reclaimed using a new fenced lease token. After an intent, an uncertain result becomes `BLOCKED` (`DISPATCH_OUTCOME_UNKNOWN`); it is never automatically dispatched again, including partial `both` dispatches. A crash after all dispatches but before receipt persistence conservatively blocks too.

GitHub must return a valid run ID for each repository before a successful receipt. Missing IDs block the operation; the bridge does not guess based on time. Resolution of uncertain/missing IDs requires verified external evidence, not another dispatch. Existing legacy run resolution is unchanged.

`RUNNING` remains until a status read proves all runs completed. Their conclusions set `SUCCEEDED` or `FAILED`; replay of a succeeded operation sets `REPLAYED` while preserving `outcome_state`. Stored responses are immutable dispatch receipts; final workflow results and available job IDs are stored separately and returned at the status URL. No workflow, gate, synthetic commit, or Render write is part of testing.

### Tests

Run `bunx vitest run src/lib/bridge/validate.test.ts src/lib/bridge/idempotency.test.ts src/lib/bridge/core.test.ts src/lib/bridge/idempotency.database.test.ts`.
Database tests use the existing server environment and only isolated `phase3-test:` records. GitHub dispatch is mocked; restart persistence is verified by a separate process reading the same Cloud record. No secret value is printed or stored.

Read-route regressions: `bunx vitest run src/lib/bridge/lookup.test.ts src/test/bridge-read-routes.test.ts`. All database reads and fetches in these tests are mocked. They verify GET 405, header-only authentication, ownership isolation, stored run IDs/URLs, and zero dispatches, GitHub calls, claim RPCs or writes. No real workflow runs.