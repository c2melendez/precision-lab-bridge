# Precision Lab Parallel Tool — Implementation Master

**Document type:** implementation and LLM handoff contract  
**Version:** 1.0.0  
**Architecture baseline:** Multi-Agent Command Plane v2  
**Status:** M1 PASS_SCOPED; M2 IN_PROGRESS (Runner worker code and component-level CI/DB evidence exist; bilateral PR acceptance and live execution remain open)  
**Canonical repository:** `c2melendez/precision-lab-bridge`  
**Working branch:** `hardening/secure-status-independent-runtime`  
**Last verified architecture commit:** `0670da3901685f7af14ad0058f8c685d0ee383e9`

This document is the operational companion to [parallel-tool-roadmap.md](./parallel-tool-roadmap.md) and [parallel-tool-roadmap.json](./parallel-tool-roadmap.json). The roadmap records the architecture and phase plan; this master records how an independent LLM must inspect, change, test, and report the implementation. It is not evidence that any pending phase has passed.

## 1. Mission and non-negotiable objective

Enable an LLM with no GitHub credentials to inspect Precision Lab state, diagnose a task, submit a bounded repository change, request approved validation, and track the resulting commit and pull request through Bridge and Runner. The system must preserve evidence from request through result. The LLM never receives GitHub, Supabase, Render, Observer service, or Runner secrets.

Target repositories:
- Lite: `c2melendez/precision-lab-lite`
- Plus: `c2melendez/precision-lab-plus`

The mathematical certification of Lite and Plus remains a separate workstream. Infrastructure CI success is not mathematical certification success.

## 2. Architecture and traffic paths

### Observer — information and policy plane
Observer is the source for current repository state, canonical branch/HEAD, continuity, gate policy, and RUN/WAIT/REUSE/RECONCILE/REFRESH decisions. It is read-oriented. It does not own command idempotency or GitHub commits.

### Bridge — authenticated command plane
Bridge is the only public command gateway for agents without GitHub access. It authenticates the caller, derives actor identity from the credential, checks scopes, retrieves current Observer context server-side, validates typed requests, persists idempotent command receipts, and exposes owner-scoped status/reconciliation. It must never trust a caller-supplied actor, PASS claim, run plan, canonical SHA, or credential.

### Runner — execution plane
Runner remains within the existing GitHub Actions execution plane in the Lite/Plus repositories. M2 will add a bounded worker workflow that consumes an opaque command ID, fetches its server-side manifest, checks identity/lease/expiry/fingerprint/allowlists/expected SHA, applies the typed patch on `agent/{command_id}`, runs named profiles, commits, opens a PR, and returns an authenticated receipt. No arbitrary shell and no automatic merge.

Supported paths:
1. LLM → Observer → Bridge → Runner.
2. LLM → Bridge → Runner; Bridge internally queries Observer.
3. Hybrid LLM → Observer GET and Bridge POST.
4. Optional delegated GitHub/Runner path for agents that already have explicitly delegated GitHub authority. This is not required for credentialless LLMs.

## 3. Credential and scope policy

Credentials are independent and server-side:
- Agent → Observer (read-only where used).
- Agent → Bridge.
- Bridge → Observer (server-only `OBSERVER_BASE_URL`, `OBSERVER_SERVICE_KEY`).
- Bridge → GitHub.
- Runner → Bridge callback.
- Runner → GitHub.
- Bridge → Supabase.

The caller's identity is the authenticated Bridge key record. Never accept actor identity from JSON. Hash keys at rest; return raw credentials once only; support expiry and revocation; log key ID/prefix, never raw secrets.

Existing Bridge scopes `read` and `dispatch` must retain their existing meaning. New scopes are opt-in only:
- `context:read`
- `command:submit`
- `command:read`

Do not silently grant new scopes to existing keys. An administrator must explicitly select scopes for each newly issued key. Keep legacy `read` / `dispatch` routes working through compatibility adapters until a separately tested migration retires them.

## 4. Command API contract

The planned public surface is:
- `GET /api/v1/capabilities`
- `GET /api/v1/context/status`
- `GET /api/v1/context/gates/{gate}/plan`
- `POST /api/v1/commands`
- `GET /api/v1/commands/{id}`
- `GET /api/v1/commands/lookup`

Authentication header: `X-Bridge-Key`. Submission header: `Idempotency-Key`, which must exactly match the body idempotency key.

Version 1 envelope:
- `schema_version`
- `command_type`
- `target_repo` (`lite` or `plus`)
- `expected_branch`
- `expected_sha` (40-character Git SHA)
- `payload` (strict command-specific schema)
- `idempotency_key`
- `correlation_id`
- `validation_id`

Initial typed command types: `repo.inspect`, `repo.patch`, `repo.validate`. File patch operations are structured create/replace/delete with safe repository-relative paths, content size limits, duplicate-path rejection, and expected blob SHA for destructive replacement/deletion. Validation profiles are named allowlisted profiles. Arbitrary shell, arbitrary workflow names, arbitrary GitHub API URLs, path traversal, secret files, and client-defined permissions are prohibited.

HTTP semantics:
- `202`: new command durably accepted (not yet executed).
- `200`: exact replay / existing owner-scoped receipt.
- `400`: malformed headers/body.
- `401`: missing, invalid, expired, or revoked key.
- `403`: authenticated key lacks required scope.
- `404`: unknown command or command not owned by caller.
- `409`: idempotency fingerprint conflict, stale branch/SHA, or reconciliation required.
- `413`: request exceeds transport limit.
- `422`: schema or typed payload invalid.
- `429`: rate limit.
- `5xx`: transient internal/upstream failure; caller must reconcile by the original idempotency key before retrying a submission.

## 5. Durable command and idempotency invariants

Every command record must include: immutable command UUID, owner key ID, idempotency key, command type, target repo, expected branch/SHA, canonical request fingerprint, bounded request payload, Observer context snapshot, correlation/validation IDs, lifecycle status, timestamps, replay/attempt counters, lease metadata, and later Actions/Runner/commit/PR references.

Required invariants:
1. Unique constraint on `(key_id, idempotency_key)`.
2. Same key + same fingerprint returns the same command/receipt and never creates a second row.
3. Same key + different fingerprint returns conflict (409).
4. Concurrent identical submissions serialize to one durable command.
5. A command can only be read/reconciled by its owner (or explicit admin policy).
6. The table and RPC are unavailable to anon/authenticated clients; only service role can call the internal RPC.
7. Database constraints validate allowed status values and fingerprints.
8. Reconciliation uses the original idempotency key; never blindly retry a POST after an ambiguous timeout.
9. Persist only after live Observer state is fetched and expected branch/SHA are checked.
10. Record an audit trail without recording raw API keys or secrets.

Lifecycle values: `accepted`, `queued`, `validating`, `running`, `awaiting_review`, `completed`, `failed`, `blocked`, `reconcile_required`. The M1 intake API remains durable-only. Receipts must keep `execution_enabled: false` until the M2 runtime is deployed, configured and explicitly enabled; M2 source code existing in draft PRs does not enable execution.

## 6. M1 implementation checklist

M1 is complete only when all items below are implemented and verified on the same commit:
- [x] OpenAPI 3.1 contract matches actual route schemas and status codes.
- [x] Capability and Observer context read routes require `context:read`.
- [x] Command submission requires `command:submit`; receipt/status/lookup require `command:read`.
- [x] Existing keys retain exactly their old scopes; admin can issue explicit new scope combinations.
- [x] Additive migration creates private `bridge_commands`, constraints, unique index, and atomic submit/replay/conflict RPC.
- [x] RPC grants are restricted to service role; RLS and database checks are included in CI.
- [x] Internal Bridge → Observer client uses server-only credentials, HTTPS origin validation, bounded routes/timeouts, redirect refusal, and safe error mapping.
- [x] Every direct Bridge command submission consults live Observer context and validates target repo, canonical branch and expected SHA before persistence.
- [x] GET command status and lookup are owner-scoped.
- [x] Tests cover auth/scope denial, old-key non-escalation, schema/path limits, exact replay, fingerprint conflict, concurrent submissions, stale SHA, upstream failures, owner isolation, and SQL grants/RLS.
- [x] CI passes for the exact branch HEAD; test skips caused by missing DB secrets are reported as skipped, not PASS for database integration.
- [x] No deployment, live command execution, or Runner dispatch is inferred from a unit/CI pass.

## 7. M2 Runner implementation checklist

M1 acceptance is complete, so M2 implementation is underway. The following items describe code-level implementation, not M2 phase acceptance:
- [x] Durable command claim/lease with 60-minute expiry and bounded attempts in the M2 migration/RPCs.
- [x] Separate `workflow_dispatch` worker workflows in the existing Lite/Plus Actions planes; no public Runner service and no changes to `certification-runner.yml`.
- [x] Workflow input contains only opaque `command_id`; request payloads and credentials stay server-side.
- [x] Runner obtains GitHub OIDC identity; Bridge validates signature, issuer, audience, repository ID/name, workflow path, event, default branch and run identity.
- [x] Claim/callback service verifies repository ownership, workflow run identity, lease token and typed manifest; SQL tests cover valid claim, wrong repository, invalid lease and idempotent callback replay.
- [x] Worker applies typed create/replace/delete operations in isolated `agent/{command_id}` branches with expected-SHA and blob-SHA preconditions, path/symlink/secret limits and compare-and-swap checks.
- [x] Fixed validation profiles only; Plus `unit` now runs backend pytest and frontend `npm test` after a clean `npm ci`.
- [x] Successful patch validation creates/reuses a draft PR; no automatic merge.
- [x] OIDC-authenticated callback persists the Actions run, status, commit and PR receipt.
- [x] Dispatch intent, same-run claim and callback replay are guarded against duplicate delivery; ambiguous outcomes reconcile rather than blindly redispatch.
- [ ] All required CI checks pass on the exact current HEAD of both target PRs. Lite remains blocked by the existing npm audit hard gate; Plus current-head checks are pending.
- [ ] A controlled real Bridge → Actions → Runner → durable receipt end-to-end run and same-idempotency replay are verified. Not performed: execution flag remains false and no live dispatch is authorized in this work block.

M2 therefore remains `IN_PROGRESS`, not `PASS_SCOPED` or `PASS`.

## 8. LLM execution protocol (mandatory for every handoff)

An LLM continuing this project must:
1. Read this master, the Markdown roadmap, the JSON roadmap, repository `README`, `AGENTS.md` if present, and the current PR/branch status.
2. Discover canonical repository, branch, HEAD, workflows, migration convention, tests, and existing route patterns from live repository metadata. Do not rely on stale handoff SHA as current HEAD.
3. Inspect the exact current source files before editing. Do not infer unseen code.
4. Work only on the approved feature branch. Never write directly to default/canonical certification branches.
5. Make a small coherent change, preserve legacy routes, and use optimistic ref updates / expected HEAD.
6. Run format, typecheck, unit tests, DB migration/RPC tests and CI where available. Distinguish local tests, skipped tests, CI, deployment, and real certification evidence.
7. Verify the exact tested SHA equals the branch/PR head SHA. Inspect job conclusions and logs before reporting.
8. If a request outcome is uncertain, query status by original idempotency key; do not create a fresh key to bypass reconciliation.
9. Do not deploy, modify secrets, mutate production DB, dispatch real certification workflows, or merge without an explicit authorization/policy basis.
10. Continue to the next phase after a phase closes; do not ask whether to continue unless a genuine ambiguity or authorization boundary blocks work.

## 9. Evidence and reporting format

For every work block record:
- task/phase and acceptance IDs;
- repository, branch, before/after HEAD;
- exact files changed and commit/PR;
- tests run, exact command, outcome and test SHA;
- CI workflow/run/job IDs and conclusion;
- DB migration application status (not merely file creation);
- deployment status (not implied by CI);
- unresolved blockers and next action.

Use precise statuses: `NOT_STARTED`, `IN_PROGRESS`, `PASS_SCOPED`, `PASS`, `BLOCKED`, `FAILED`, `SKIPPED`, `NOT_APPLICABLE`. Never call a phase PASS while mandatory acceptance evidence is absent.

### M1 acceptance evidence — PASS_SCOPED

**Código verificado:** `b622a26605b1402c73fe1aff327fc2f1941bc1e2` en `hardening/secure-status-independent-runtime`.
**CI exacto:** [run 41172743808](https://github.com/c2melendez/precision-lab-bridge/actions/runs/41172743808), `completed / success`, ambos jobs sobre el mismo SHA.

- Aplicación: Vitest `111 passed`; las 19 pruebas DB se omiten en este job general y se ejecutan en el job dedicado. ESLint terminó sin errores (6 warnings React Fast Refresh). Build Vite/Nitro: SUCCESS.
- Base desechable: migración completa y `supabase db reset` SUCCESS; comprobaciones de RLS/grants/FKs/uniqueness/RPC SUCCESS; contrato SQL M1 SUCCESS; **19/19 tests de integración DB PASS**; `supabase db lint`: `No schema errors found`.
- Seguridad: claves existentes `read`/`dispatch` no se amplían; scopes nuevos son opt-in. La RPC comprueba la autorización dentro de DB; tabla privada con RLS/grants de service role. El replay devuelve el recibo inicial. El POST limita el cuerpo mientras lee el stream.
- Límites: no es una prueba HTTP live contra Render/Observer. `OBSERVER_SERVICE_KEY` está declarado como variable server-only, pero su valor no se ha configurado en Render y no se ha desplegado esta versión. La lectura de archivos/contexto queda en M3. No hay Runner: recibos reportan `execution_enabled: false`. No se modificaron Lite/Plus, no hubo dispatch real, merge ni migración de producción.

M1 se registra **PASS_SCOPED**: evidencia completa de código/CI/DB en el SHA citado, con activación operativa/live aún fuera del alcance. M2 se registra **IN_PROGRESS**: hay implementación de worker en PRs Draft, pruebas unitarias y SQL de Bridge, y validación parcial de repositorios objetivo; aún faltan los checks bilaterales completos y la prueba end-to-end con despacho real.

### M2 implementation evidence — IN_PROGRESS (2026-10-31, exact target heads)

**Bridge**
- PR [#1](https://github.com/c2melendez/precision-lab-bridge/pull/1), branch `hardening/secure-status-independent-runtime`, current HEAD `50978189950cd36cdae6ea4e19f87006ce1aa1d5`. The commit contains the user-authored mechanism review and roadmap adjustments; those additions have been preserved.
- CI [41178465402](https://github.com/c2melendez/precision-lab-bridge/actions/runs/41178465402) **SUCCESS** on that exact HEAD: unit/regression tests, ESLint, Node build, complete disposable Supabase migration replay, RPC security/RLS/grants, legacy/M1/M2 SQL contracts, database-backed idempotency/Command API tests and schema lint all passed.
- Dispatcher fix verified on code SHA `11108701f4f0699ecb9fffa72daaadb0d7f3937b`, CI [41177703847](https://github.com/c2melendez/precision-lab-bridge/actions/runs/41177703847) **SUCCESS**: repository-slug workflow lookup (no duplicated owner), no durable dispatch intent without the feature flag and a valid server-side `GH_TOKEN`, exact lookup URL, unrelated-run polling, no blind redispatch and callback lease hashing.
- No production Bridge deploy, production Supabase migration, real workflow dispatch or privileged secret mutation was performed.

**Lite**
- Draft PR [#60](https://github.com/c2melendez/precision-lab-lite/pull/60), branch `feature/m2-command-runner-bridge`, current HEAD `f7c4cf6ac31967b74e936ba38d1597404e652e33`.
- CI [41178122450](https://github.com/c2melendez/precision-lab-lite/actions/runs/41178122450) **FAILURE** solely at the existing npm audit hard gate. The separate Runner safety-contract job **SUCCESS**. Audit report: 11 findings (3 low, 8 moderate, 0 high, 0 critical); typecheck, unit/parity tests and build were correctly SKIPPED after the gate failed.
- Playwright E2E [41178122439](https://github.com/c2melendez/precision-lab-lite/actions/runs/41178122439) **SUCCESS** and cross-browser smoke [41178122475](https://github.com/c2melendez/precision-lab-lite/actions/runs/41178122475), both on the exact current SHA.
- One finding is `deepmerge@4.3.1` through `@rollup/plugin-node-resolve`; the current GitHub advisory identifies versions through 4.3.1 as affected and lists no patched npm release. No audit threshold was lowered, no waiver was added, no forced downgrade was used, and no unreviewed local fork was introduced.
- Every Node-based Runner profile executes `npm ci` followed by `npm audit --package-lock-only` before tests/lint/typecheck/build. The worker cannot validate/publish a patch while this hard gate fails.

**Plus**
- Draft PR [#41](https://github.com/c2melendez/precision-lab-plus/pull/41), branch `feature/m2-command-runner-bridge`, current HEAD `5288fae3f42065e3246f62e9f017098a1bad5cc4`.
- Normal CI [41178121902](https://github.com/c2melendez/precision-lab-plus/actions/runs/41178121902) **SUCCESS** on the exact current SHA: frontend audit/typecheck/unit/parity/build, backend tests and Runner safety-contract all passed. Frontend lockfile synchronization is recorded in commit [`d54d80a`](https://github.com/c2melendez/precision-lab-plus/commit/d54d80af0294ba781d9d8d30114f82bb8891cc93), retaining security overrides.
- Playwright E2E [41178121954](https://github.com/c2melendez/precision-lab-plus/actions/runs/41178121954) remains **IN_PROGRESS** on the same SHA; dependency installation and Chromium setup passed, and the E2E test step is still running.

**Acceptance and operational boundary:** all three PRs remain Draft/open/unmerged. Lite's hard audit gate and Plus E2E still prevent bilateral M2 completion. `BRIDGE_COMMAND_EXECUTION_ENABLED=false`; no production deploy, secret change, production DB migration, real `workflow_dispatch`, command-generated patch/commit/PR or mathematical certification was performed. O6/O7 remain PENDING. M2 cannot be accepted until Lite's audit findings are remediated under security policy and an authorized Bridge → Actions → Runner → durable receipt → Observer E2E trace with same-idempotency replay is verified.

## 10. Phase status at this revision

| Phase | Status | Meaning |
|---|---|---|
| A | PASS (historical) | Observer → Bridge staging receipt; preserve evidence, do not rerun without invalidation |
| B | PASS (historical) | Observer contract/read checks; preserve evidence |
| M0 | COMPLETED | Architecture v2 recorded in roadmap Markdown/JSON |
| M1 | PASS_SCOPED | Command API, DB/RPC, scopes, Observer context client, routes and acceptance tests passed in CI on code SHA `b622a26605b1402c73fe1aff327fc2f1941bc1e2`; runtime deployment/live Observer auth not verified |
| M2 | IN_PROGRESS | Bridge current-head CI+DB SUCCESS; Lite current-head Runner contract/E2E/cross-browser SUCCESS but CI blocked by npm audit (11 findings: 3 low/8 moderate); Plus current-head normal CI SUCCESS and E2E IN_PROGRESS. All PRs Draft; no deploy/live dispatch. Phase acceptance remains open |
| M3 | NOT_STARTED | Route parity / hybrid paths acceptance |
| M4 | NOT_STARTED | REST/OpenAPI, Function Calling, GPT Actions and MCP adapters |
| M5 | NOT_STARTED / CONDITIONAL | SDKs, CLI, webhooks, A2A and framework/provider adapters |
| M6 | NOT_STARTED | Dos LLM distintos, dos transportes, pruebas A–F de conectividad/seguridad y benchmark CB1–CB10; lectura → diagnóstico → patch → validación → commit/PR → reconciliación sin credenciales GitHub en los agentes |
| M7 | NOT_STARTED | Freeze infrastructure and resume math certification |

The historical A/B results do not prove M1/M2. CI on this documentation commit does not prove code execution or math certification.

### M6 — cualificación de consumidores y capacidades LLM

M6 contiene dos pistas independientes, definidas en `docs/parallel-tool-consumer-probe-battery.md` v2.1.0:
- **Conectividad y seguridad (A–F):** rutas Observer/Bridge, scopes, contratos, idempotencia, aislamiento de rama, auditoría de conectores e higiene de secretos.
- **Capacidad técnica (CB1–CB10):** comprensión del repositorio, diagnóstico, planificación, generación de correcciones, selección de pruebas, interpretación de CI, corrección iterativa, incertidumbre, resistencia a prompt injection y continuidad multiagente.
- **Acceso de credenciales (TCA):** TCA-1 inyecta claves Bridge desde el host sin revelarlas al modelo; TCA-2 usa exclusivamente un canary sintético en un laboratorio separado. G1–G5 son pruebas de exposición controlada, independientes de M6.

No confundir PASS de conectividad con competencia técnica ni benchmark offline con ejecución end-to-end. Comparar modelos con prompts, fixtures, SHA, permisos, transportes y presupuestos equivalentes; procurar al menos tres repeticiones comparables por modelo/tarea.

**Política de credenciales:** el operador provisiona claves de consumidor directamente en el gestor de secretos/host/MCP/conector; el runtime adjunta las cabeceras. Nunca pedir ni incluir claves en prompts, mensajes, archivos, argumentos visibles de herramientas o reportes. Si no existe una frontera segura que oculte el secreto al modelo, la prueba se marca `BLOCKED/credential_not_provisioned`. Cada consumidor tiene identidad propia y scopes mínimos. Secretos internos Bridge→Observer, GitHub, Supabase, Render y Runner permanecen server-side.

**Emisión de claves Bridge:** esta rama contiene el panel de administración en `/` (`src/routes/index.tsx`) y la función `createKey` (`src/lib/bridge/admin.functions.ts`). El operador entra en el panel del despliegue verificado, introduce allí `BRIDGE_ADMIN_PASSWORD` directamente, asigna etiqueta/duración/scopes y crea la clave. La clave completa se muestra una sola vez; se copia directamente al secret store del host y no al prompt. Bridge persiste hash/prefijo, no el valor recuperable. Verificar que el SHA desplegado contiene esta implementación antes de depender del panel. La contraseña admin no es una credencial de consumidor.

**Diseño TCA:** ver `docs/temporary-credential-access-design.md`. TCA-D0 queda documentado; TCA-1, Credential Lab TCA-2 y Credential Broker no están implementados ni habilitados. TCA-2 no es requisito de M6 ni permite utilizar una clave Bridge real visible al LLM.

La aceptación M6 exige dos modelos LLM distintos (model_id/versión diferenciados), dos identidades de consumidor independientes y dos transportes reales, y una traza completa request → command → receipt → Actions → Runner → commit/PR → tests → reconciliación, con replay sin duplicado y sin credenciales GitHub entregadas a los agentes.

## 11. Handoff prompt for an independent LLM

> You are continuing Precision Lab Parallel Tool implementation. Read `docs/parallel-tool-implementation-master.md`, `docs/parallel-tool-roadmap.md`, and `docs/parallel-tool-roadmap.json` before acting. Use live GitHub repository state as source of truth. M1 is PASS_SCOPED on code SHA `b622a26605b1402c73fe1aff327fc2f1941bc1e2`, CI run 41172743808; do not repeat it absent invalidating evidence. M2 is IN_PROGRESS: stabilize the existing Bridge PR #1, Lite PR #60 and Plus PR #41; review the current M2 evidence in section 10, finish exact-head target CI, and keep Lite's npm audit gate intact. Do not treat component-level CI as phase acceptance. Keep GitHub/Supabase/Observer/Runner credentials server-side; never request or expose them to the LLM. Preserve old scopes and legacy routes; no arbitrary shell; no production deployment, live Runner dispatch, merge, or mathematical certification run unless explicitly authorized. Keep `BRIDGE_COMMAND_EXECUTION_ENABLED=false`. Use expected-SHA concurrency protection. Record exact tests, SHA, workflow runs and blockers. Once M2 is accepted, continue M3 without asking for routine continuation. If repository state differs from this document, reconcile against live source before editing.

## 12. Related authoritative records

- [Temporary Credential Access design](./temporary-credential-access-design.md)
- [Architecture roadmap (Markdown)](./parallel-tool-roadmap.md)
- [Architecture roadmap (JSON)](./parallel-tool-roadmap.json)
- Bridge CI workflow: `.github/workflows/bridge-ci.yml`
- Bridge PR: [PR #1](https://github.com/c2melendez/precision-lab-bridge/pull/1)
