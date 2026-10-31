# Precision Lab Bridge

Independent Node.js service for coordinating certification requests between authenticated LLM clients, the Precision Lab read-only observer, Supabase persistence, and GitHub Actions runners.

## Architecture

- **Observador:** reports current status and evidence; it does not execute gates.
- **Bridge:** authenticates callers, validates typed commands, applies owner-scoped durable idempotency, and separately coordinates the existing certification workflow dispatch/status lifecycle.
- **Runner:** GitHub Actions workflows execute the requested certification gates and publish evidence.
- **Persistence:** Supabase PostgreSQL stores bridge keys, generic command receipts, run receipts, call audit records, and the separate workflow idempotency lifecycle.

The application uses TanStack Start, Vite, and Nitro's standard Node server preset. Platform-specific editor, preview-auth, build, and telemetry integrations have been removed. Supabase remains an external service dependency and must be configured independently.

## Local development

Requirements: Node.js 22.12 or newer, plus Bun.

```sh
bun install --frozen-lockfile
bun run dev
```

## Validation and production commands

```sh
bun run test
bun run lint
bun run build
bun run start
```

The production build uses Nitro's `node-server` preset by default and starts with `node .output/server/index.mjs`. The Render Blueprint sets `NITRO_PRESET=render-com`, binds to `HOST=0.0.0.0`, and uses the platform-provided `PORT`. The independent Render web service has been created in My Workspace in Virginia on the Free plan, with auto-deploy disabled. Its initial build/deploy from the hardening branch reached LIVE on 2026-10-30. It is not yet configured with privileged Supabase/GitHub/admin secrets and must not be treated as production-ready.

## Render configuration

The root render.yaml describes the independent Node web service in Virginia on the Free plan. It installs from bun.lock, builds the application, and starts the Nitro server. It sets autoDeployTrigger off; the existing direct-created service is separate from any future Blueprint sync. Secret values use Render's `sync: false` placeholders and must be supplied in the Render Dashboard. Render only prompts for these placeholders during initial Blueprint creation; later new secrets must be added manually in the Dashboard.

## Environment variables

Copy `.env.example` to `.env` for local development, then supply values through a local secret manager or hosting environment.

| Variable | Purpose | Exposure |
|---|---|---|
| `SUPABASE_URL` | Supabase project URL used by server code | Server |
| `SUPABASE_SECRET_KEY` | Modern server-side Supabase secret key used by Bridge operations; legacy `SUPABASE_SERVICE_ROLE_KEY` remains a temporary fallback | **Server secret only** |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key for server auth validation | Server |
| `VITE_SUPABASE_URL` | Supabase URL available to the browser client | Public |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key available to the browser client | Public |
| `GH_TOKEN` | GitHub token used by the Bridge to dispatch and inspect workflows | **Server secret only** |
| `GH_OWNER` | GitHub account or organization containing target repositories | Server |
| `OBSERVER_BASE_URL` | HTTPS origin of the read-only Precision Lab Observer | Server |
| `OBSERVER_SERVICE_KEY` | Server-to-server API key used by Bridge when querying Observer | **Server secret only** |
| `GH_REF` | Default ref for Runner workflow dispatches (defaults to `main`) | Server |
| `BRIDGE_ADMIN_PASSWORD` | Protects Bridge administration functions | **Server secret only** |
| `BRIDGE_CRON_SECRET` | Optional bearer secret for protected cron requests | **Server secret only** |
| `BRIDGE_CRON_SECRET_PREVIOUS` | Optional previous cron secret during rotation | **Server secret only** |
| `DATABASE_URL` | Direct PostgreSQL connection used by Drizzle CLI tools only | **Server secret only** |

Never prefix privileged values with `VITE_`; Vite embeds `VITE_*` values in browser assets. Do not commit `.env` files.

## M1 Command API — durable intake only

The v1 command API is separate from the legacy workflow-dispatch API. It authenticates with `X-Bridge-Key` and requires explicit opt-in scopes:

- `context:read` for capabilities and Observer context reads.
- `command:submit` for durable command submission.
- `command:read` for owner-scoped receipt lookup.

Existing `read` and `dispatch` keys are not granted any of these scopes by the M1 migration. Administrators select scopes explicitly when issuing a new key.

| Method | Route | Purpose | Scope |
|---|---|---|---|
| GET | `/api/v1/capabilities` | Supported typed commands and permission requirements | `context:read` |
| GET | `/api/v1/context/status` | Current Observer repository status | `context:read` |
| GET | `/api/v1/context/gates/:gate/plan` | Read-only gate plan from Observer | `context:read` |
| POST | `/api/v1/commands` | Validate and durably accept an idempotent typed command | `command:submit` |
| GET | `/api/v1/commands/:id` | Read a command receipt owned by the calling key | `command:read` |
| GET | `/api/v1/commands/lookup` | Reconcile an uncertain submission by its original idempotency key | `command:read` |

Importable contract: [OpenAPI 3.1](docs/parallel-tool-command-openapi.v1.yaml).

A new submission requires the current canonical branch and current HEAD reported by Observer. A stale SHA or Observer state requiring reconciliation returns 409 before a new row is accepted. The durable key is unique per credential owner; exact retries replay the same receipt, while a changed request fingerprint conflicts. Command records start as `accepted` and return `execution_enabled: false` while M2 is not deployed/configured and explicitly enabled. M1 intake itself never applies patches, runs validation jobs, creates commits or pull requests; those operations belong to the separate M2 Runner plane.

Initial types are `repo.inspect`, `repo.patch`, and `repo.validate`. Patch payloads use typed create/replace/delete file operations, bounded UTF-8 content, duplicate-path rejection and expected blob SHAs for replacement/deletion. Traversal, secret material, environment files and workflow definitions are rejected. No arbitrary shell or workflow dispatch is accepted by this API.

Observer credentials are held only in the Bridge server environment. Direct Bridge command submission reads Observer state server-side; LLM clients never receive `OBSERVER_SERVICE_KEY` or GitHub credentials.

## M2 Runner execution plane — implementation in progress

M2 adds a separate internal Runner path in the existing Lite/Plus GitHub Actions repositories. It does not replace or modify `certification-runner.yml`.

- Bridge creates a durable dispatch intent before calling GitHub. Only the opaque `command_id` is sent as a `workflow_dispatch` input; request payloads and credentials are not passed to the workflow.
- The Runner obtains a GitHub OIDC token with audience `precision-lab-bridge`. Bridge validates the issuer, signature, audience, repository ID/name, workflow path, default branch, event and run identity.
- A service-role RPC binds the command to the exact Actions run, issues a 60-minute lease and limits the claim count. The callback is OIDC-authenticated and additionally must present the current lease token.
- The worker accepts only the typed `repo.inspect`, `repo.validate` and `repo.patch` contracts. Patch files are bounded, path/symlink/secret checks are enforced, and replacement/deletion requires the expected Git blob SHA.
- The worker verifies the Observer-supplied canonical branch and SHA, rechecks the SHA before publishing an isolated `agent/{command_id}` branch, runs fixed repository-specific profiles, and creates/reuses a draft PR. The Plus `unit` profile installs the synchronized frontend lockfile and validates backend pytest plus frontend `npm test`. Every Node-based profile executes `npm ci` followed by the repository's `npm audit --package-lock-only` hard gate before profile checks; a failing audit blocks the worker from validating/publishing a PR. The worker never merges.
- Ambiguous dispatch outcomes are reconciled by the exact workflow run name and persisted as `reconcile_required` when no unique run can be established. An existing durable dispatch intent is never re-dispatched automatically.

**Implementation evidence (2026-10-31):** Bridge PR [#1](https://github.com/c2melendez/precision-lab-bridge/pull/1) current HEAD `50978189950cd36cdae6ea4e19f87006ce1aa1d5` passed full CI [41178465402](https://github.com/c2melendez/precision-lab-bridge/actions/runs/41178465402), including tests/lint/build, full disposable Supabase migration replay, SQL security/RPC checks and DB tests. Lite PR [#60](https://github.com/c2melendez/precision-lab-lite/pull/60) current HEAD has Runner contract, Playwright E2E and cross-browser SUCCESS; normal CI remains blocked by npm audit (11 findings: 3 low, 8 moderate, 0 high/critical), including upstream `deepmerge@4.3.1` for which no patched npm release is currently listed. The hard gate remains intact. Plus PR [#41](https://github.com/c2melendez/precision-lab-plus/pull/41) current-head CI [41178121902](https://github.com/c2melendez/precision-lab-plus/actions/runs/41178121902) is SUCCESS; Playwright [41178121954](https://github.com/c2melendez/precision-lab-plus/actions/runs/41178121954) remains in progress. All Node Runner profiles enforce `npm ci` and `npm audit --package-lock-only` before profile validation.

**Operational state:** `BRIDGE_COMMAND_EXECUTION_ENABLED=false` by default and remains false in the Render Blueprint and `.env.example`. The worker code is on open Draft PRs, not deployed or merged. No production deployment, live workflow dispatch or command-generated patch/commit/PR has been performed. Bridge→Observer live authentication is not yet verified, and Plus/Lite PR acceptance remains incomplete. These implementation and CI results do not constitute M2 phase acceptance or mathematical certification.

## API contract

### Create a run

`POST /api/runs` requires `X-Bridge-Key` and an `Idempotency-Key` header (or the documented JSON idempotency field). Durable claims and dispatch intents are recorded before contacting GitHub. An uncertain dispatch becomes `BLOCKED / DISPATCH_OUTCOME_UNKNOWN` and must not be automatically retried.

### Get a run by ID

`GET /api/runs/:id` requires `X-Bridge-Key`. Credentials in `?key=` are rejected with `400 QUERY_CREDENTIALS_NOT_SUPPORTED`. The run query is scoped by both run ID and owning key ID. A missing run and a run owned by another key both return 404. Older rows without an owner key are intentionally not exposed through this endpoint.

A status read performs GitHub GET requests and may persist reconciliation results to `bridge_runs` and `bridge_idempotency`; it is not a database-pure read. It also updates key last-use metadata and call audit records.

### Lookup by idempotency key

`GET /api/runs/lookup` requires both `X-Bridge-Key` and `Idempotency-Key` headers. It scopes the lookup to the authenticated key and can reconcile a running request against GitHub, including persisting the resulting state. It does not dispatch workflows.

### Disabled legacy route

`GET /api/run` always returns `405 METHOD_NOT_ALLOWED` and never triggers a workflow.

## Database and migrations

- [Independent Render service status and secret checklist](docs/render-independent-service-status.md)

- [Supabase migration and verification status](docs/supabase-migration-plan.md)
- [Observador–Bridge credential boundary and cutover](docs/observer-bridge-integration.md)


SQL migration definitions are in `drizzle/migrations`. The configuration reads `DATABASE_URL`. Migrations are not applied automatically at build or startup; review and run them as a separate, explicitly authorized operation against the intended Supabase project.

## Security and operational guardrails

- Bridge credentials are stored as hashes; full keys are shown once at creation.
- Use a private repository and private hosting environment for this service.
- Keep GitHub and Supabase privileged credentials out of browser bundles and source control.
- Do not dispatch real workflows, deploy, or modify Precision Lab Lite/Plus as part of ordinary local validation.
- Tests should mock GitHub dispatch and use isolated fixtures.
