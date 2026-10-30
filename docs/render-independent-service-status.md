# Render independent Bridge service — status 2026-10-30

## Resource
- Service: precision-lab-bridge
- Render ID: srv-dbi5b8ss728c73ccvjbg
- Workspace: My Workspace (tea-da4esd7qj5pc73d1fss0)
- Dashboard: https://dashboard.render.com/web/srv-dbi5b8ss728c73ccvjbg
- URL: https://precision-lab-bridge.onrender.com
- Region: virginia, aligned with Supabase us-east-1
- Compute: free, for staging/validation only
- Source: c2melendez/precision-lab-bridge, branch hardening/secure-status-independent-runtime
- Auto-deploy: off
- Build: bun install --frozen-lockfile && bun run build
- Start: bun run start
- Deploy: dep-dbi5b9cs728c73ccvl20, status live, commit fec4dd1448b0385f98565725276b235ddc0821a2

## What Render verified
- Bun 1.4.4 selected from .bun-version.
- 532 packages installed.
- Vite client and SSR compilation succeeded.
- Nitro render-com output generated successfully.
- Nitro server started and logged its listener on port 10000.
- Render event deploy_ended reported succeeded.
- Render auto-deploy remains off.

Non-fatal build warnings:
- Vite notes vite-tsconfig-paths can be replaced by native tsconfig path resolution.
- TanStack Start marks three uses of createServerFn().inputValidator() deprecated in favor of .validator().
- The browser bundle contains a chunk larger than 500 kB after minification.

These warnings were not build failures. Schedule cleanup, but they do not invalidate the successful build.

## Variables already set (non-secret)
- NODE_ENV=production
- NITRO_PRESET=render-com
- HOST=0.0.0.0
- GH_OWNER=c2melendez
- GH_REF=main
- SUPABASE_URL and VITE_SUPABASE_URL point to https://umxtvefdcjwkiqsubfpb.supabase.co
- SUPABASE_PUBLISHABLE_KEY and VITE_SUPABASE_PUBLISHABLE_KEY contain the publishable key for this project

## Secrets (user confirmed configured)
The user confirmed on 2026-10-30 that the following three secrets were entered in the Render Dashboard. Render then recorded an environment-triggered deployment (`envUpdated=true`) that ended `LIVE`. The connector cannot inspect individual variable names or values, so functional verification is the next step. Do not ask the user to paste the values here.
1. SUPABASE_SECRET_KEY — modern Supabase secret key sb_secret_ for project umxtvefdcjwkiqsubfpb, available in Supabase Settings → API Keys. Server-only. Never use the publishable key here.
2. GH_TOKEN — for the first non-dispatch verification, use a dedicated GitHub fine-grained personal access token with Actions: Read restricted to c2melendez/precision-lab-lite and c2melendez/precision-lab-plus (Metadata: Read is automatic). This lets the Bridge inspect an existing Actions run without dispatch permission. Only when a separate production-dispatch cutover is approved should the token be upgraded to Actions: Read and write. Do not substitute Observador's GITHUB_READ_TOKEN.
3. BRIDGE_ADMIN_PASSWORD — unique strong password for the Bridge admin UI, stored in a password manager.

Render Dashboard environment page:
https://dashboard.render.com/web/srv-dbi5b8ss728c73ccvjbg/env

Do not paste secrets into chat, GitHub, source control or logs. Once the variables are saved, deploy the resulting environment update from Render; auto-deploy is deliberately off. Verify deploy LIVE afterwards.

## Cutover safety
- Original Lovable Compass remains untouched.
- Observador's llm variable remains untouched.
- No llm API key has been generated on this new database.
- No actual GitHub workflow dispatch was performed.
- No Lite/Plus repository was modified by this service creation.
- No production traffic has been moved.
- The new project's bridge_keys remains empty until an admin-authenticated temporary/test key is deliberately created.

## Next controlled verification
1. Add the three privileged secrets above.
2. Deploy the environment update; verify the deploy is LIVE and runtime logs contain no secret values.
3. Sign in to the admin UI using BRIDGE_ADMIN_PASSWORD.
4. Create a temporary key with a label other than llm.
5. Use a pre-existing GitHub Actions run from Lite or Plus as a read-only fixture: insert one owner-scoped bridge_runs receipt associated with the temporary key and that already-existing GitHub run ID. Do not call POST /api/runs and do not create a new GitHub run.
6. Validate GET /api/runs/:id against that fixture. The Bridge should use GitHub Actions read permission only, fetch the existing run state, and record its audit/last-used updates. Confirm no GitHub dispatch occurred.
7. Only then prepare an Observador canary using a new llm key; retain the old service/key until proven safe.

## Free plan caveat
This service is currently on Render Free for staging and initial validation. Free web services spin down after 15 minutes without inbound traffic and can take about a minute to wake. They are not recommended for production. Upgrade before moving real Observador/Bridge traffic.


## Environment update and read-only fixture — 2026-10-30

The user confirmed that the three privileged secrets (`SUPABASE_SECRET_KEY`, `GH_TOKEN`, `BRIDGE_ADMIN_PASSWORD`) were entered in the Render Dashboard.

Render records an environment-triggered deployment:
- Deploy: `dep-dbi5jc8ae00c73b9tnvg`
- Trigger: `service_updated`
- Render event: `deploy_started` has `envUpdated=true`
- Result: `deploy_ended` with `deployStatus=succeeded`
- Final status: `live` at 2026-10-30T08:47:57Z
- Runtime logs show Bun 1.4.4 and Nitro listening on port 10000.

The Render connector does not expose individual environment variable names or secret values for read-back. The user's confirmation plus the envUpdated deployment event is evidence of an environment change and successful restart, but not an independent inspection of each secret's name/value. No secret values were read or printed.

The four Supabase Bridge tables were re-counted after this deployment and still contain zero rows. No API request has yet been received by the new service, and no admin login has yet been observed in request logs.

### Selected existing GitHub read-only fixture

Use this pre-existing successful run from Precision Lab Lite:
- Repository: `c2melendez/precision-lab-lite`
- GitHub Actions run ID: `41005884405`
- Workflow: Certification Runner, run number 65
- Branch: `main`
- Event: `workflow_dispatch` (historical completed execution; do not dispatch another)
- Status/conclusion: `completed / success`
- Run created: `2026-10-30T04:59:19Z`
- URL: https://github.com/c2melendez/precision-lab-lite/actions/runs/41005884405

This specific existing run was fetched from the GitHub Actions REST API. It is suitable for a GET-only status fixture. The verification will add a single owner-scoped `bridge_runs` record to the isolated new database, pointing to this existing GitHub run. It will not call the Bridge trigger route and will not create a new GitHub workflow run.

Before inserting that fixture, the user must sign into the new Bridge Admin UI and create a one-day temporary key labelled `staging-read-only-verification`. The raw key must be copied and retained by the user only; never paste it into ChatGPT. Once the row is visible in `bridge_keys`, its non-secret UUID and prefix can be used to attach the run fixture to that key. The user can then run the supplied local PowerShell GET check with their retained key. Do not send the key in the chat.
