# Precision Lab Parallel Tool — Implementation Master

**Document type:** implementation and LLM handoff contract  
**Version:** 1.0.0  
**Architecture baseline:** Multi-Agent Command Plane v2  
**Status:** M1 implementation in progress; M2 not started  
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

Lifecycle values: `accepted`, `queued`, `validating`, `running`, `awaiting_review`, `completed`, `failed`, `blocked`, `reconcile_required`. M1 only accepts and records; it must report `execution_enabled: false` until M2 exists.

## 6. M1 implementation checklist

M1 is complete only when all items below are implemented and verified on the same commit:
- [ ] OpenAPI 3.1 contract matches actual route schemas and status codes.
- [ ] Capability and Observer context read routes require `context:read`.
- [ ] Command submission requires `command:submit`; receipt/status/lookup require `command:read`.
- [ ] Existing keys retain exactly their old scopes; admin can issue explicit new scope combinations.
- [ ] Additive migration creates private `bridge_commands`, constraints, unique index, and atomic submit/replay/conflict RPC.
- [ ] RPC grants are restricted to service role; RLS and database checks are included in CI.
- [ ] Internal Bridge → Observer client uses server-only credentials, HTTPS origin validation, bounded routes/timeouts, redirect refusal, and safe error mapping.
- [ ] Every direct Bridge command submission consults live Observer context and validates target repo, canonical branch and expected SHA before persistence.
- [ ] GET command status and lookup are owner-scoped.
- [ ] Tests cover auth/scope denial, old-key non-escalation, schema/path limits, exact replay, fingerprint conflict, concurrent submissions, stale SHA, upstream failures, owner isolation, and SQL grants/RLS.
- [ ] CI passes for the exact branch HEAD; test skips caused by missing DB secrets are reported as skipped, not PASS for database integration.
- [ ] No deployment, live command execution, or Runner dispatch is inferred from a unit/CI pass.

## 7. M2 Runner checklist

M2 begins only after M1 acceptance:
- [ ] Durable command claim/lease with expiry and bounded attempts.
- [ ] Runner workflow is in existing Lite/Plus Actions plane; no separate public Runner service.
- [ ] Workflow input contains opaque command ID only; no raw secrets or unbounded patch body.
- [ ] Runner obtains command manifest using OIDC/workload identity or one-time short TTL lease token.
- [ ] Verify command owner, lease, expiry, schema, payload fingerprint, target, expected branch/SHA and allowlisted profile.
- [ ] Apply patch in isolated `agent/{command_id}` branch using compare-and-swap expected SHA.
- [ ] Run named tests; no arbitrary shell command supplied by LLM.
- [ ] Create commit and PR only after required checks pass; never merge automatically.
- [ ] Authenticated callback stores Actions run, status, commit and PR receipt.
- [ ] Duplicate workflow delivery is idempotent; expired/ambiguous work reconciles rather than double-commits.

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

## 10. Phase status at this revision

| Phase | Status | Meaning |
|---|---|---|
| A | PASS (historical) | Observer → Bridge staging receipt; preserve evidence, do not rerun without invalidation |
| B | PASS (historical) | Observer contract/read checks; preserve evidence |
| M0 | COMPLETED | Architecture v2 recorded in roadmap Markdown/JSON |
| M1 | IN_PROGRESS | Command API implementation and acceptance tests being prepared; do not claim complete |
| M2 | NOT_STARTED | Runner repository worker not implemented |
| M3 | NOT_STARTED | Route parity / hybrid paths acceptance |
| M4 | NOT_STARTED | REST/OpenAPI, Function Calling, GPT Actions and MCP adapters |
| M5 | NOT_STARTED / CONDITIONAL | SDKs, CLI, webhooks, A2A and framework/provider adapters |
| M6 | NOT_STARTED | Two LLMs, two transports, no GitHub credentials, end-to-end command lifecycle |
| M7 | NOT_STARTED | Freeze infrastructure and resume math certification |

The historical A/B results do not prove M1/M2. CI on this documentation commit does not prove code execution or math certification.

## 11. Handoff prompt for an independent LLM

> You are continuing Precision Lab Parallel Tool implementation. Read `docs/parallel-tool-implementation-master.md`, `docs/parallel-tool-roadmap.md`, and `docs/parallel-tool-roadmap.json` before acting. Use live GitHub repository state as source of truth. Continue the first incomplete phase only; currently M1. Implement and test the M1 checklist on the approved Bridge feature branch. Keep GitHub/Supabase/Observer/Runner credentials server-side; never request or expose them to the LLM. Preserve old scopes and legacy routes; no arbitrary shell; no production deployment, live Runner dispatch, merge, or mathematical certification run unless explicitly authorized. Use expected-SHA concurrency protection. Verify all tests and CI against the exact final HEAD, record evidence using section 9, update the roadmap and this master with factual status, and proceed to the next phase without asking for routine continuation. If repository state differs from this document, report and reconcile against live source before editing.

## 12. Related authoritative records

- [Architecture roadmap (Markdown)](./parallel-tool-roadmap.md)
- [Architecture roadmap (JSON)](./parallel-tool-roadmap.json)
- Bridge CI workflow: `.github/workflows/bridge-ci.yml`
- Bridge PR: [PR #1](https://github.com/c2melendez/precision-lab-bridge/pull/1)
