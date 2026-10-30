## Implementation status — 2026-10-30

The isolated Supabase project has been created and initialized:

- Project: precision-lab-bridge-db
- Project ref: umxtvefdcjwkiqsubfpb
- Region: us-east-1; state: ACTIVE_HEALTHY
- Creation quote: $0/month at creation time (not a promise about future billing).
- Four migrations are applied and recorded: 20261030075859, 20261030075922, 20261030075926, and 20261030075930.
- Source-controlled migration equivalents live under supabase/migrations/ and supabase/config.toml points to the new ref.
- All four Bridge tables exist, have RLS enabled, and currently contain zero rows.
- Verified: anon and authenticated cannot SELECT any Bridge table; service_role has SELECT/INSERT/UPDATE/DELETE. The five RPC functions are SECURITY INVOKER, use search_path=public, reject anon/authenticated execution, and allow service_role execution.
- Default privileges for future public objects were tightened. Supabase Security Advisor reports four informational RLS Enabled No Policy findings; this is intentional because the tables are server-only and have no client policies.
- No legacy records or key hashes have been imported. The source database remains untouched.

This is a prepared database target, not yet connected to a deployed Bridge service. Do not switch the currently running Lovable/Render integration until the independent Bridge host is configured and its read-only connection test passes.

# Supabase target and migration plan

Status: isolated database and schema initialized; source-data migration and runtime cutover remain pending.

## 1. What the repository currently defines

The recovered source has three ordered SQL migrations under `drizzle/migrations/`:

| Migration | Objects introduced |
|---|---|
| `0000_migration.sql` | `bridge_keys`, `bridge_runs`, `bridge_calls` |
| `0001_bridge_durable_idempotency.sql` | `bridge_idempotency` plus five PostgreSQL RPC functions |
| `0002_bridge_lifecycle_integrity.sql` | `workflow_result` column and lifecycle CHECK constraint |

### Tables

- `public.bridge_keys`: bridge API key metadata and SHA-256 hash; stores a short `key_prefix`, not the full API key. Includes created/expiry/revocation/last-used timestamps.
- `public.bridge_runs`: Bridge run ID, target, gate, dry-run flag, dispatch time, GitHub run receipt array, and nullable `key_id`.
- `public.bridge_calls`: audit history (endpoint, key prefix, request parameters, HTTP status, result and timestamp).
- `public.bridge_idempotency`: durable unique idempotency key, owning `key_id`, fingerprint and request payload, lifecycle state, immutable receipt, leases, dispatch intents, GitHub run IDs, job IDs, workflow outcome and timestamps. Its `run_id` references `bridge_runs(id)`.

### RPC functions

The first durable migration defines `bridge_claim`, `bridge_prepare`, `bridge_begin_dispatch`, `bridge_record_dispatch`, and `bridge_finish`. They are `SECURITY INVOKER` functions with an explicit `search_path`; their execution is revoked from `PUBLIC`, `anon`, and `authenticated`, then granted to `service_role`.

### Security characteristics visible in the SQL

- Row Level Security is enabled on all four Bridge tables.
- All four tables explicitly revoke access from `PUBLIC`, `anon`, and `authenticated`, and retain CRUD access for `service_role`. RLS is enabled on each table.
- The initial migration does not define client-facing RLS policies. The intended access model is privileged server-side access only.
- `bridge_idempotency.key_id` is NOT NULL but has no foreign key to `bridge_keys(id)`.
- `bridge_runs.key_id` is nullable and has no foreign key. The status endpoint intentionally does not expose ownerless legacy rows.
- The source `drizzle/schema.ts` is intentionally blank. The SQL migration chain and Drizzle journal are present, but the ORM schema file is not a complete declarative representation of the tables.

## 2. Repository and Supabase discovery findings

- The source snapshot's original `supabase/config.toml` contained project reference `gsoydjodruelcepbomxz`. This is recorded as an origin hint only; it has not been verified as an accessible live project.
- The connected Supabase account currently lists no projects. Direct inspection of that original project was denied by the connected Supabase tool, so live table definitions, migration history, extensions and row counts remain unverified.
- The project precision-lab-bridge-db was created in c2melendez's Org in us-east-1 with a $0/month creation quote. Project ref: umxtvefdcjwkiqsubfpb.
- The historical SQL remains in drizzle/migrations for provenance. Four timestamped Supabase migrations in supabase/migrations now own remote schema delivery. Their prefixes are the exact versions recorded by Supabase after successful application.

## 3. Recommended target setup

1. **Completed:** a dedicated Supabase project named precision-lab-bridge-db was created in the confirmed organization and us-east-1. It is separate from the original Lovable Cloud database.
2. **Completed:** the new project was initialized as an empty database. It was not linked to or used to overwrite the source project.
3. **Completed for the initial schema:** the three original migration stages were ported in order to supabase/migrations, followed by one security migration that revokes client-role access and tightens default privileges. Timestamp prefixes match the versions returned by Supabase after applying; no timestamps were manually invented. Future schema changes should use the Supabase CLI migration workflow.
4. **Partially complete:** the chain was applied to the new empty remote database, and tables, functions, grants and RLS were queried afterwards. A local Supabase stack reset was not run because the Supabase CLI is not installed in this execution environment; local reset validation is still pending.
5. **Completed:** verified the new-project Data API posture and tested table privilege facts using PostgreSQL catalog queries. The `anon` and `authenticated` roles have no table SELECT privileges; `service_role` can perform the required CRUD operations. No direct client-role access was granted.
6. **Completed:** the initial migration and the follow-up security migration revoke client-role table grants and revoke default privileges for new public tables, sequences, and functions. Public EXECUTE is removed from future functions; server-role execution is retained.
7. Review adding foreign keys from `bridge_idempotency.key_id` to `bridge_keys(id)` and from non-null `bridge_runs.key_id` values to `bridge_keys(id)`. First check for orphaned references. Preserve nullable ownerless legacy runs only if historical status retrieval is still required; the current API does not expose them.

## 4. Data migration plan (separate from schema)

Do not copy data until the destination schema and server-side access tests pass.

1. **Inventory source (read-only):** verify current row counts, migration history, foreign-key violations, RLS state, table grants, extensions and any non-Bridge objects. Identify whether Auth users, Storage buckets/objects, Edge Functions or custom Auth providers exist; none are defined by the three Bridge SQL migrations.
2. **Choose data scope:** migrate only the Bridge tables unless the inventory proves another resource is needed:
   - `bridge_keys` (hashes and metadata; plaintext keys cannot be recovered from the database);
   - `bridge_runs` (including GitHub run IDs/URLs and owner IDs);
   - `bridge_idempotency` (receipts, idempotency keys, fingerprints, states, dispatch intents and job/outcome details);
   - `bridge_calls` (audit records, subject to a retention/privacy review).
3. **Freeze the source:** schedule a controlled write freeze. Reconcile known RUNNING requests first. Do not migrate active lease tokens as if they were live ownership in the target. For any uncertain dispatch, preserve the conservative `BLOCKED / DISPATCH_OUTCOME_UNKNOWN` outcome; never trigger a second workflow just to recreate evidence.
4. **Back up and export:** take a recoverable source backup. Export the four selected tables in a consistent snapshot. Keep schema/functions out of the data dump because they are deployed by migrations. Protect dump files as sensitive records and never put connection strings or secrets in Git.
5. **Import in dependency order:** import owning keys and runs before idempotency rows; preserve UUIDs so references and API receipts remain stable. Load audit calls separately if retention policy allows.
6. **Verify:** compare per-table row counts; check unique idempotency keys, missing key owners, orphaned run IDs, state totals, JSON receipts, dispatch intents, run IDs, job IDs, timestamps, and RLS/grants. Verify a known key by hashing an externally held test credential; do not print or copy plaintext credentials into the database or logs.
7. **Cut over:** update only the new Bridge host's Supabase URL, publishable key, and server-only service-role key. Run read-only status/lookup checks first. Enable POST dispatch only after the new instance passes review and a separate controlled smoke approval.
8. **Rollback:** keep the old database intact and available during a defined observation window. Roll back by restoring the old service configuration; never write back migrated target data into the source automatically.

## 5. Secret handling and runtime configuration

- New target variables: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Keep `SUPABASE_SECRET_KEY`, `GH_TOKEN`, `BRIDGE_ADMIN_PASSWORD`, database passwords and connection strings server-side only. Never prefix them with `VITE_`. The modern `sb_secret_` key is preferred; the code retains `SUPABASE_SERVICE_ROLE_KEY` only as a compatibility fallback for pre-existing deployments.
- Set a new `BRIDGE_ADMIN_PASSWORD` in the hosting secret store. It is not migrated from SQL.
- Existing bridge keys can remain valid only if their key-hash rows are deliberately migrated. Otherwise, issue replacement keys and distribute them through the normal one-time display flow.
- The original Supabase project API keys and database password must not be copied into the new project.

## 6. Explicit non-actions in this phase

- The isolated project and its schema were created/applied.
- The original/source database was not queried or changed.
- No source data, key hashes, runs, idempotency entries or audit records were exported or imported.
- No key values, environment files, connection strings or credentials copied.
- No Render service created/deployed.
- No GitHub certification-runner workflow dispatched.
- No changes to Precision Lab Lite or Precision Lab Plus.

## 7. Completion gates

- [x] New Supabase project created in the selected organization/region.
- [ ] Original source project read access restored or a verified backup supplied.
- [x] Supabase migration chain created and applied to the new project.
- [ ] Empty-database local reset passes.
- [x] New project schema, functions, grants and RLS verified.
- [ ] Table-level data export/import plan reconciled with actual source counts.
- [ ] Test restore succeeds and all row/integrity counts match.
- [ ] Runtime is configured with new secrets and status/read-only tests pass.
- [ ] Separate approval obtained before enabling any real GitHub workflow dispatch.
