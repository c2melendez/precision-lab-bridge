# Precision Lab Bridge — contributor guidance

## Security boundaries
- Never accept bridge credentials in URL query parameters. Use the `X-Bridge-Key` header.
- Every run-status read must constrain the run by its owning `bridge_keys.id`; return the same 404 for absent and foreign-owned run IDs.
- Keep `GH_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `BRIDGE_ADMIN_PASSWORD`, and database credentials server-side only.
- Only the public Supabase URL and publishable key may use `VITE_*` environment names.
- Do not store secrets in source, fixtures, logs, issue text, or commit messages.

## Architecture
- Observador: read-only status and evidence consumer.
- Bridge: authenticates callers, validates and records requests, applies durable idempotency, and coordinates GitHub.
- Runner: GitHub Actions workflows execute certification gates and publish evidence.
- Bridge persistence uses Supabase PostgreSQL; privileged server-side access is isolated in `*.server.ts` modules.

## Operational guardrails
- Do not dispatch workflows, deploy services, execute database migrations, or alter Lite/Plus repositories without explicit authorization.
- Do not bypass durable claim/dispatch-intent lifecycle rules.
- Never blindly retry an uncertain GitHub dispatch; preserve `BLOCKED / DISPATCH_OUTCOME_UNKNOWN`.
- Keep tests deterministic: mock GitHub calls and isolate any database fixtures.
