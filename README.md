# Precision Lab Bridge

Independent Node.js service for coordinating certification requests between authenticated LLM clients, the Precision Lab read-only observer, Supabase persistence, and GitHub Actions runners.

## Architecture

- **Observador:** reports current status and evidence; it does not execute gates.
- **Bridge:** authenticates callers, validates requests, applies durable idempotency, and coordinates workflow dispatch and status reconciliation.
- **Runner:** GitHub Actions workflows execute the requested certification gates and publish evidence.
- **Persistence:** Supabase PostgreSQL stores bridge keys, run receipts, call audit records, and idempotency lifecycle state.

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

The production build uses Nitro's `node-server` preset by default and starts with `node .output/server/index.mjs`. The Render Blueprint sets `NITRO_PRESET=render-com`, binds to `HOST=0.0.0.0`, and uses the platform-provided `PORT`. The Blueprint is configuration only; no Render service has been created and no deployment has been performed.

## Render configuration

The root `render.yaml` describes a Node web service that installs from `bun.lock`, builds the application, and starts the Nitro server. It sets `autoDeployTrigger: "off"`; creating or syncing the Blueprint is a separate, user-controlled operation. Secret values use Render's `sync: false` placeholders and must be supplied in the Render Dashboard. Render only prompts for these placeholders during initial Blueprint creation; later new secrets must be added manually in the Dashboard.

## Environment variables

Copy `.env.example` to `.env` for local development, then supply values through a local secret manager or hosting environment.

| Variable | Purpose | Exposure |
|---|---|---|
| `SUPABASE_URL` | Supabase project URL used by server code | Server |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged database client used by bridge operations | **Server secret only** |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key for server auth validation | Server |
| `VITE_SUPABASE_URL` | Supabase URL available to the browser client | Public |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key available to the browser client | Public |
| `GH_TOKEN` | GitHub token used by the Bridge to dispatch and inspect workflows | **Server secret only** |
| `GH_OWNER` | GitHub account or organization containing target repositories | Server |
| `GH_REF` | Default ref for Runner workflow dispatches (defaults to `main`) | Server |
| `BRIDGE_ADMIN_PASSWORD` | Protects Bridge administration functions | **Server secret only** |
| `BRIDGE_CRON_SECRET` | Optional bearer secret for protected cron requests | **Server secret only** |
| `BRIDGE_CRON_SECRET_PREVIOUS` | Optional previous cron secret during rotation | **Server secret only** |
| `DATABASE_URL` | Direct PostgreSQL connection used by Drizzle CLI tools only | **Server secret only** |

Never prefix privileged values with `VITE_`; Vite embeds `VITE_*` values in browser assets. Do not commit `.env` files.

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

SQL migration definitions are in `drizzle/migrations`. The configuration reads `DATABASE_URL`. Migrations are not applied automatically at build or startup; review and run them as a separate, explicitly authorized operation against the intended Supabase project.

## Security and operational guardrails

- Bridge credentials are stored as hashes; full keys are shown once at creation.
- Use a private repository and private hosting environment for this service.
- Keep GitHub and Supabase privileged credentials out of browser bundles and source control.
- Do not dispatch real workflows, deploy, or modify Precision Lab Lite/Plus as part of ordinary local validation.
- Tests should mock GitHub dispatch and use isolated fixtures.
