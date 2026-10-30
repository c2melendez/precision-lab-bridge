// Read-only lookup plus GitHub status reconciliation: it may persist a final
// SUCCEEDED/FAILED state for a RUNNING record whose runs all completed (the same
// conditional update GET /api/runs/:id uses), but it never dispatches a workflow,
// never creates or claims requests, never logs calls and never touches other records.
// GitHub access is GET-only; on any GitHub or storage failure the stored state is
// returned unchanged.
type GhRun = { repo: string; run_id: number | null; html_url: string | null };
type RunResult = { repo: string; status: string; conclusion: string | null; url: string | null };

async function ghGet(path: string): Promise<Response> {
  const token = process.env["GH_TOKEN"];
  const owner = process.env["GH_OWNER"];
  if (!token || !owner) throw new Error("GitHub is not configured");
  return fetch(`https://api.github.com/repos/${owner}/${path}`, {
    signal: AbortSignal.timeout(30_000),
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "precision-lab-bridge",
    },
  });
}

// Reconcile a RUNNING record against GitHub run status; mirrors runStatus in core.server.ts.
async function reconcileRunning(record: {
  id: string;
  state: string;
  gh_runs: unknown;
}): Promise<{ state: string; outcomeState: string | null; runs: RunResult[] | null }> {
  const stored = record.gh_runs as unknown as GhRun[];
  if (!Array.isArray(stored) || stored.length === 0 || stored.some((r) => !r?.run_id)) {
    return { state: record.state, outcomeState: null, runs: null };
  }
  let results: RunResult[];
  try {
    results = await Promise.all(
      stored.map(async (r) => {
        const res = await ghGet(`${r.repo}/actions/runs/${r.run_id}`);
        if (!res.ok) throw new Error(`GitHub status ${res.status}`);
        const j = (await res.json()) as { status: string; conclusion: string | null; html_url: string };
        return { repo: r.repo, status: j.status, conclusion: j.conclusion, url: j.html_url };
      }),
    );
  } catch {
    // GitHub unreachable or errored: keep the stored state, change nothing.
    return { state: record.state, outcomeState: null, runs: null };
  }
  if (!results.every((r) => r.status === "completed")) {
    return { state: record.state, outcomeState: null, runs: results };
  }
  const final = results.every((r) => r.conclusion === "success") ? "SUCCEEDED" : "FAILED";
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: updated, error } = await supabaseAdmin.from("bridge_idempotency")
    .update({
      state: final,
      outcome_state: final,
      workflow_result: results as never,
      updated_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    })
    .eq("id", record.id).eq("state", "RUNNING").select("state").maybeSingle();
  if (error) return { state: record.state, outcomeState: null, runs: results };
  // Another writer may have finished it first; only adopt the final state if our
  // conditional update actually landed.
  return updated?.state === final
    ? { state: final, outcomeState: final, runs: results }
    : { state: record.state, outcomeState: null, runs: results };
}

export async function lookupRequest(key: string | null, idempotencyKey: string | null) {
  if (!key || key.length > 200) {
    return { status: 401, body: { error: "invalid, expired or revoked key" } };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const keyHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const { data: credential, error: keyError } = await supabaseAdmin.from("bridge_keys")
    .select("id, expires_at, revoked_at").eq("key_hash", keyHash).maybeSingle();
  if (keyError) return { status: 503, body: { error: "STATUS_STORE_UNAVAILABLE" } };
  const expiresAt = credential ? Date.parse(credential.expires_at) : NaN;
  if (!credential || credential.revoked_at || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return { status: 401, body: { error: "invalid, expired or revoked key" } };
  }
  if (!idempotencyKey || !/^[A-Za-z0-9._:-]{1,200}$/.test(idempotencyKey)) {
    return { status: 400, body: { error: "Idempotency-Key is required (1–200 letters, numbers, . _ : -)" } };
  }

  // Match credential ownership in the query; never reveal another key's request.
  const { data: record, error } = await supabaseAdmin.from("bridge_idempotency")
    .select("id, state, outcome_state, run_id, gh_runs, job_ids, error_code, updated_at")
    .eq("idempotency_key", idempotencyKey).eq("key_id", credential.id).maybeSingle();
  if (error) return { status: 503, body: { error: "STATUS_STORE_UNAVAILABLE" } };
  if (!record) return { status: 404, body: { error: "not found" } };

  let state = record.state as string;
  let outcomeState = record.outcome_state as string | null;
  let runs = record.gh_runs;
  if (state === "RUNNING") {
    const reconciled = await reconcileRunning(record);
    state = reconciled.state;
    if (reconciled.outcomeState) outcomeState = reconciled.outcomeState;
    if (reconciled.runs) runs = reconciled.runs as never;
  }

  return { status: 200, body: {
    idempotency_id: record.id,
    state,
    outcome_state: outcomeState,
    run_id: record.run_id,
    status_url: record.run_id ? `/api/runs/${record.run_id}` : null,
    runs,
    job_ids: record.job_ids,
    error_code: record.error_code,
    updated_at: record.updated_at,
  } };
}