<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture
- POST `/api/runs` alone calls the shared `trigger()` in `core.server.ts`; GET `/api/run` returns 405 with no bridge imports, preventing unsafe GET dispatches.
- GET `/api/runs/lookup` delegates to isolated `lookup.server.ts`, requires X-Bridge-Key and Idempotency-Key headers and scopes reads to the credential owner; no writes, claim RPCs or GitHub requests keep lookup strictly read-only.
- Durable idempotency uses service-role-only PostgreSQL RPCs in `idempotency.server.ts`, with a global unique key and canonical fingerprint; atomic claims and per-repository intents precede all dispatches to eliminate read-before-write races.
- Expired leases can be reclaimed only before an external dispatch intent; uncertain dispatches become BLOCKED and never auto-dispatch again because GitHub does not provide exactly-once dispatch correlation.
- Dispatch receipts are replayed byte-for-byte while lifecycle outcomes are tracked separately; legacy time-only run resolution is forbidden for durable claims because it cannot prove run identity.
- Bridge tables are service-role only (RLS on, no policies); all access goes through server code, because callers authenticate with bridge keys, not app sessions.
- Bridge keys are stored only as SHA-256 hashes plus a short prefix for logs; the full key is shown once at creation.
- The admin page is gated by the BRIDGE_ADMIN_PASSWORD secret checked in every admin server function.