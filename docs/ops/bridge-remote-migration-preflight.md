# Bridge remote migration — application record

Status: **APPLIED — VERIFIED (2026-10-30 UTC)**  
Target: Supabase project `umxtvefdcjwkiqsubfpb` (`precision-lab-bridge-db`, `us-east-1`)  
Applied migration version: `20261030200900`  
Repository migration: `supabase/migrations/20261030200900_bridge_security_ownership_and_rpc_integrity.sql`  
Source branch: `hardening/secure-status-independent-runtime`  
Source commit at application: `61daa189191453070beb4c13b3679960b3f57c3b`

## Application result

The sixth migration was applied successfully through the Supabase migration workflow. Supabase recorded version `20261030200900`; the repository migration filename was aligned to that recorded version in commit `e0bc3e35c89fa152cd59177c18863ac140e28bcb` so local and remote migration histories remain synchronized.

No application deployment, PR merge, key rotation, production traffic cutover, or Lite/Plus workflow dispatch was performed.

## Lightweight pre-application safeguard

Immediately before DDL, the target project was confirmed `ACTIVE_HEALTHY`, and migration history contained exactly the five expected earlier migrations. The sixth version was absent.

Observed table counts before application:
- `bridge_keys=2`
- `bridge_runs=1`
- `bridge_calls=2`
- `bridge_idempotency=0`

All blocker checks returned zero:
- NULL or orphan `bridge_runs.key_id`
- Orphan `bridge_idempotency.key_id`
- Invalid, NULL, or duplicate scopes
- Duplicate scoped idempotency keys
- Active leases
- Unresolved dispatch intents
- Malformed active claims
- Idempotency/run owner mismatches

The pre-application catalog snapshot retained the table columns, RLS flags, constraints, and definitions of all five existing RPCs. Sensitive key hashes and credentials were not exported or exposed. Given the database was newly created and contained only the small fixture set above, this lightweight safeguard was used instead of blocking on a full restore-tested backup.

## Post-application verification

Supabase migration history now contains the six expected versions, ending in `20261030200900_bridge_security_ownership_and_rpc_integrity`.

Verified remotely:
- `bridge_runs.key_id` is NOT NULL and its FK to `bridge_keys(id)` is validated.
- `bridge_idempotency.key_id` has a validated FK to `bridge_keys(id)`.
- The old global idempotency uniqueness constraint was replaced by validated `UNIQUE (key_id, idempotency_key)`.
- The stricter scopes CHECK is validated.
- All five RPCs are `SECURITY INVOKER`, use `search_path=public`, deny EXECUTE to `PUBLIC`, `anon`, and `authenticated`, and grant EXECUTE to `service_role`.
- RLS remains enabled on all four private tables; `anon` and `authenticated` have no SELECT privileges, while `service_role` retains SELECT.
- Data counts are unchanged: 2 keys, 1 run, 2 calls, 0 idempotency rows.
- All post-migration owner-integrity, lease, and dispatch-intent blocker counts remain zero.

## Advisors

The existing informational findings remain:
- Four `rls_enabled_no_policy` INFO findings for the intentionally private, service-role-only tables.
- Two unused-index INFO findings (`bridge_runs_dedupe_idx` and the newly created `bridge_runs_key_id_idx`) on this small database.

No public RLS policies were added and no advisor findings were suppressed. Reassess index usage after real traffic exists.

## CI and remaining boundary

The pre-application source commit `61daa189191453070beb4c13b3679960b3f57c3b` had both CI jobs SUCCESS, including local replay of all six migrations, functional tests for all five RPCs, lint, and build.

The filename-alignment commit `e0bc3e35c89fa152cd59177c18863ac140e28bcb` triggered a new Bridge CI run; its result must be checked before treating the updated PR head as CI-verified.

PR #1 remains open and Draft. The migration does not authorize merging the PR or deploying Bridge. Those remain separate gates requiring separate approval.


## Conciliación CI posterior — 2026-10-30 UTC

- Bridge CI #58: [41121256457](https://github.com/c2melendez/precision-lab-bridge/actions/runs/41121256457), asociado al commit de alineación `e0bc3e35c89fa152cd59177c18863ac140e28bcb`; ambos jobs SUCCESS.
- Bridge CI #59: [41121381925](https://github.com/c2melendez/precision-lab-bridge/actions/runs/41121381925), asociado al HEAD actualizado del PR `f8ea3afa74c0f6d5546c1a5bc3e3f2e26f768239`; ambos jobs SUCCESS.
- En ambos runs el job de migraciones reconstruyó la cadena completa en Supabase local desechable, ejecutó las aserciones estructurales, las pruebas funcionales de las cinco RPC y `supabase db lint`.
- La rama contiene `supabase/migrations/20261030200900_bridge_security_ownership_and_rpc_integrity.sql`, blob SHA `488779521e6df48964234e171ec15db07d82c8fb`; la versión `20261030200900` coincide con el historial remoto.
- La verificación remota de solo lectura posterior confirmó que el proyecto sigue ACTIVE_HEALTHY, con 2 claves, 1 run, 2 calls, 0 idempotencias; cinco RPC SECURITY INVOKER con EXECUTE solo para service_role; RLS activo en las cuatro tablas.
- Los cuatro avisos INFO de RLS sin políticas y los dos avisos INFO de índices no utilizados permanecen sin cambios.
- No se fusionó el PR, no se desplegó Bridge, no se cambió producción, no se rotaron claves y no se despacharon workflows Lite/Plus.
