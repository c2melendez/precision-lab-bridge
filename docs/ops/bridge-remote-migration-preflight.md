# Bridge remote migration preflight

Status: **PREPARED — NOT EXECUTED**  
Target: Supabase project `umxtvefdcjwkiqsubfpb`  
Migration: `20261030185628_bridge_security_ownership_and_rpc_integrity`

This document is an operator checklist and read-only preflight. It does not apply DDL, alter migration history, deploy Bridge, or authorize a production change.

## Current read-only observation (2026-10-30)

The remote migration history contains exactly the five previously applied migrations:

- `20261030075859_bridge_base_schema_and_private_table_grants`
- `20261030075922_bridge_durable_idempotency_and_rpcs`
- `20261030075926_bridge_lifecycle_integrity`
- `20261030075930_bridge_private_grants_and_default_privileges`
- `20261030133052_bridge_key_scopes`

Observed row counts: `bridge_keys=2`, `bridge_runs=1`, `bridge_calls=2`, `bridge_idempotency=0`.  
Observed blockers: no NULL or orphan run owner, no orphan idempotency owner, no invalid/duplicate scopes, no duplicate scoped idempotency key, and no malformed active lease.

These are a dated observation, not a substitute for repeating the checks immediately before applying the migration.

## Read-only preflight SQL

Run the following against the target project using a read-only SQL session. Do not add DDL or DML to this script.

```sql
SELECT
  (SELECT count(*) FROM public.bridge_keys) AS bridge_keys,
  (SELECT count(*) FROM public.bridge_runs) AS bridge_runs,
  (SELECT count(*) FROM public.bridge_calls) AS bridge_calls,
  (SELECT count(*) FROM public.bridge_idempotency) AS bridge_idempotency,
  (SELECT count(*) FROM public.bridge_runs WHERE key_id IS NULL) AS runs_null_key,
  (SELECT count(*) FROM public.bridge_runs r
     LEFT JOIN public.bridge_keys k ON k.id=r.key_id WHERE k.id IS NULL) AS runs_orphan_key,
  (SELECT count(*) FROM public.bridge_idempotency i
     LEFT JOIN public.bridge_keys k ON k.id=i.key_id WHERE k.id IS NULL) AS idempotency_orphan_key,
  (SELECT count(*) FROM public.bridge_keys
     WHERE cardinality(scopes) NOT BETWEEN 1 AND 2
       OR scopes <@ ARRAY['read','dispatch']::text[] IS NOT TRUE
       OR array_position(scopes,NULL) IS NOT NULL
       OR cardinality(scopes) <> (SELECT count(DISTINCT scope) FROM unnest(scopes) AS scope)
  ) AS invalid_scope_rows,
  (SELECT count(*) FROM (
     SELECT key_id,idempotency_key FROM public.bridge_idempotency
     GROUP BY key_id,idempotency_key HAVING count(*)>1
  ) d) AS duplicate_scoped_keys,
  (SELECT count(*) FROM public.bridge_idempotency
     WHERE state='RUNNING' AND lease_expires_at>clock_timestamp()) AS active_leases,
  (SELECT count(*) FROM public.bridge_idempotency
     WHERE state='RUNNING' AND response IS NULL AND dispatch_intents<>'{}'::jsonb
  ) AS unresolved_dispatch_intents;
```

All blocker counts must be zero. If any count changes from the dated observation, stop and reconcile the rows before considering the migration. In particular, do not auto-assign NULL owners or retry unresolved dispatch intents.

Confirm migration history separately. The migration version `20261030185628` must be absent before first application. If it is already present, do not apply it again; inspect schema and history for a partial or completed application.

## Preconditions for an authorized application window

1. Confirm the target project reference and production database identity.
2. Confirm a current recoverable backup/PITR point and an operator-approved recovery path.
3. Re-run all read-only preflight queries immediately before DDL.
4. Confirm zero active leases and zero unresolved dispatch intents; pause new Bridge dispatch traffic for the DDL window if Bridge has been deployed by then.
5. Confirm migration history still contains the five expected versions and does not contain `20261030185628`.
6. Confirm the migration file SHA is the reviewed PR version and its source branch/commit are recorded.
7. Apply exactly this one migration through the approved Supabase migration workflow. Do not manually paste fragments or re-run it after an ambiguous result without inspecting migration history and schema.
8. Verify the sixth migration version is recorded, all five RPC definitions and grants match the reviewed version, the two owner FKs are validated, `bridge_runs.key_id` is NOT NULL, the composite idempotency unique constraint exists, and the strict scopes CHECK exists.
9. Re-run row-integrity checks and Supabase security/performance advisors. The current INFO advisory `rls_enabled_no_policy` on the four private Bridge tables is expected for the present service-role-only design; do not add public policies to silence it.
10. Only after database verification, plan the matching Bridge application deployment as a separate explicitly approved operation. Do not merge or deploy as part of the migration preflight.

## Stop conditions

Stop without applying if the project reference differs, the migration is already recorded, any preflight blocker is nonzero, a lease/dispatch is unresolved, a backup/recovery path cannot be confirmed, or the deployed application/schema version cannot be established.

**No remote migration, deployment, or PR merge has been performed as part of preparing this document.**
