// Server-only bridge logic: key checks, dispatch to GitHub Actions, run status, call logging.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { TARGETS, validateTrigger } from "./validate";
import { validateIdempotency, type IdempotentRequest } from "./idempotency";
import { claimRequest, prepareRun, beginDispatch, recordDispatch, finishClaim, type ClaimRecord } from "./idempotency.server";

const WORKFLOW = "certification-runner.yml";
type GhRun = { repo: string; run_id: number | null; html_url: string | null };

export async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function newKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `plb_${b64}`;
}

export const prefixOf = (key: string) => key.slice(0, 10);

export async function checkKey(key: string | null) {
  if (!key || key.length > 200) return null;
  const { data } = await supabaseAdmin.from("bridge_keys").select("*").eq("key_hash", await sha256(key)).maybeSingle();
  if (!data || data.revoked_at || new Date(data.expires_at) < new Date()) return null;
  await supabaseAdmin.from("bridge_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return data;
}

async function logCall(endpoint: string, key: string | null, params: unknown, status: number, result: unknown) {
  await supabaseAdmin.from("bridge_calls").insert({
    endpoint,
    key_prefix: key ? prefixOf(key) : null,
    params: params as never,
    http_status: status,
    result: result as never,
  });
}

function gh(path: string, init: RequestInit = {}) {
  const token = process.env["GH_TOKEN"];
  if (!token) throw new Error("GH_TOKEN is not configured");
  return fetch(`https://api.github.com/${path}`, {
    ...init,
    signal: AbortSignal.timeout(30_000),
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "precision-lab-bridge",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
}

const owner = () => {
  const o = process.env["GH_OWNER"];
  if (!o) throw new Error("GH_OWNER is not configured");
  return o;
};

// Definitive GitHub rejection (401/403/404/422): no run was created, safe to fail and retry.
export class DispatchRejected extends Error {
  constructor(public readonly status: number) {
    super(`GITHUB_DISPATCH_REJECTED_${status}`);
  }
}

// Uncertain outcome (network error, timeout, 5xx, or run not located): never auto-retry.
export class DispatchUncertain extends Error {
  constructor() {
    super("DISPATCH_OUTCOME_UNKNOWN");
  }
}

const DEFINITIVE_REJECTIONS = new Set([401, 403, 404, 422]);

async function dispatch(repo: string, p: IdempotentRequest): Promise<GhRun> {
  const ref = p.requested_sha ?? p.branch;
  const since = new Date().toISOString();
  let res: Response;
  try {
    res = await gh(`repos/${owner()}/${repo}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: "POST",
      body: JSON.stringify({
        ref,
        inputs: { target_repo: p.target_repo, gate: p.gate, dry_run: String(p.dry_run) },
        return_run_details: true,
      }),
    });
  } catch {
    // Network error or timeout: the dispatch may have landed, outcome unknown.
    throw new DispatchUncertain();
  }
  if (DEFINITIVE_REJECTIONS.has(res.status)) throw new DispatchRejected(res.status);
  if (!res.ok && res.status !== 204) throw new DispatchUncertain(); // 5xx and other unexpected statuses
  if (res.status === 200) {
    const j = (await res.json().catch(() => ({}))) as { workflow_run_id?: number; html_url?: string };
    if (j.workflow_run_id && Number.isSafeInteger(j.workflow_run_id) && j.workflow_run_id > 0) {
      return { repo, run_id: j.workflow_run_id, html_url: j.html_url ?? null };
    }
  }
  // 204 (or 200 without a run id): locate the run this dispatch created before claiming uncertainty.
  const found = await resolveRun({ repo, run_id: null, html_url: null }, since, ref);
  if (found.run_id) return found;
  throw new DispatchUncertain();
}

// Find the dispatch run created after `since`, matching the dispatched ref when given.
async function resolveRun(r: GhRun, since: string, ref?: string): Promise<GhRun> {
  if (r.run_id) return r;
  const res = await gh(
    `repos/${owner()}/${r.repo}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=10&created=>=${encodeURIComponent(
      new Date(new Date(since).getTime() - 30_000).toISOString(),
    )}`,
  );
  if (!res.ok) return r;
  const j = (await res.json()) as {
    workflow_runs: { id: number; html_url: string; created_at: string; head_branch: string; head_sha: string }[];
  };
  const run = j.workflow_runs
    .filter((w) => !ref || w.head_branch === ref || w.head_sha === ref)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  return run ? { repo: r.repo, run_id: run.id, html_url: run.html_url } : r;
}

export async function trigger(endpoint: string, key: string | null, raw: Record<string, unknown>) {
  const safeParams = { target_repo: raw["target_repo"], gate: raw["gate"], dry_run: raw["dry_run"] };
  const k = await checkKey(key);
  if (!k) {
    const out = { error: "invalid, expired or revoked key" };
    await logCall(endpoint, key, safeParams, 401, out);
    return { status: 401, body: out };
  }
  const v = validateTrigger(raw);
  if (!v.ok) {
    const out = { error: v.error };
    await logCall(endpoint, key, safeParams, 400, out);
    return { status: 400, body: out };
  }
  const parsed = validateIdempotency(raw, v.params, process.env["GH_REF"] || "main");
  if (!parsed.ok) {
    const out = { error: parsed.error };
    await logCall(endpoint, key, safeParams, 400, out);
    return { status: 400, body: out };
  }
  const p = parsed.request;
  let record: ClaimRecord | undefined;
  let dispatchStarted = false;
  try {
    const claim = await claimRequest(k.id, p, sha256);
    if (claim.action === "conflict") {
      const out = { error: "IDEMPOTENCY_CONFLICT" };
      await logCall(endpoint, key, p, 409, out);
      return { status: 409, body: out };
    }
    if (claim.action === "replay") {
      await logCall(endpoint, key, p, claim.record.http_status ?? 200, claim.record.response);
      return { status: claim.record.http_status ?? 200, body: claim.record.response };
    }
    if (claim.action === "busy") {
      const out = { idempotency_id: claim.record.id, state: "RUNNING", reused: true };
      await logCall(endpoint, key, p, 202, out);
      return { status: 202, body: out };
    }
    record = claim.record;
    const id = await prepareRun(record);
    const repos = TARGETS[p.target_repo];
    // Each external boundary is durably marked first; never blindly retry an uncertain dispatch.
    for (const repo of repos) {
      await beginDispatch(record, repo);
      dispatchStarted = true;
      const dispatched = await dispatch(repo, p);
      await recordDispatch(record, dispatched);
    }
    const out = { id, reused: false, target_repo: p.target_repo, gate: p.gate, dry_run: p.dry_run,
      idempotency_id: record.id, status_url: `/api/runs/${id}` };
    await finishClaim(record, "RUNNING", 201, out);
    await logCall(endpoint, key, p, 201, out);
    return { status: 201, body: out };
  } catch (e) {
    if (e instanceof DispatchRejected && record) {
      // GitHub definitively rejected the dispatch: no run exists, safe to fail and retry later.
      const out = { error: e.message, idempotency_id: record.id };
      try { await finishClaim(record, "FAILED", 502, out, e.message); }
      catch { /* Durable claim survives; a retry replays or recovers conservatively. */ }
      await logCall(endpoint, key, p, 502, out);
      return { status: 502, body: out };
    }
    const code = dispatchStarted ? "DISPATCH_OUTCOME_UNKNOWN" : "CLAIM_OR_PREPARE_UNAVAILABLE";
    const status = dispatchStarted ? 409 : 503;
    const out = { error: code, ...(record ? { idempotency_id: record.id } : {}) };
    if (record) {
      try { await finishClaim(record, dispatchStarted ? "BLOCKED" : "FAILED", status, out, code); }
      catch { /* Durable claim/intent survives; a retry replays or recovers conservatively. */ }
    }
    await logCall(endpoint, key, p, status, out);
    return { status, body: out };
  }
}

export async function runStatus(key: string | null, id: string) {
  const endpoint = "GET /api/runs/:id";
  const k = await checkKey(key);
  if (!k) {
    const out = { error: "invalid, expired or revoked key" };
    await logCall(endpoint, key, { id }, 401, out);
    return { status: 401, body: out };
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: 400, body: { error: "bad id" } };
  const { data: run } = await supabaseAdmin.from("bridge_runs").select("*").eq("id", id).maybeSingle();
  if (!run) {
    await logCall(endpoint, key, { id }, 404, { error: "not found" });
    return { status: 404, body: { error: "not found" } };
  }
  const { data: ledger, error: ledgerError } = await supabaseAdmin.from("bridge_idempotency").select("*").eq("run_id", id).maybeSingle();
  if (ledgerError) return { status: 503, body: { error: "STATUS_STORE_UNAVAILABLE" } };
  const runs = run.gh_runs as unknown as GhRun[];
  // Time-only run matching is retained for legacy runs, never used as evidence for durable claims.
  const resolved = ledger ? runs : await Promise.all(runs.map((r) => resolveRun(r, run.dispatched_at)));
  if (resolved.some((r, i) => r.run_id !== runs[i]?.run_id)) {
    await supabaseAdmin.from("bridge_runs").update({ gh_runs: resolved as never }).eq("id", id);
  }
  const results = await Promise.all(
    resolved.map(async (r) => {
      if (!r.run_id) return { repo: r.repo, status: "pending", conclusion: null, url: null };
      const res = await gh(`repos/${owner()}/${r.repo}/actions/runs/${r.run_id}`);
      if (!res.ok) return { repo: r.repo, status: `error ${res.status}`, conclusion: null, url: r.html_url };
      const j = (await res.json()) as { status: string; conclusion: string | null; html_url: string };
      let job_ids: number[] = [];
      if (ledger) {
        const jobsResponse = await gh(`repos/${owner()}/${r.repo}/actions/runs/${r.run_id}/jobs?per_page=100`);
        if (jobsResponse.ok) {
          const jobs = (await jobsResponse.json()) as { jobs?: { id: number }[] };
          job_ids = (jobs.jobs ?? []).map((job) => job.id).filter(Number.isSafeInteger);
        }
      }
      return { repo: r.repo, status: j.status, conclusion: j.conclusion, url: j.html_url, job_ids };
    }),
  );
  let currentState = ledger?.state;
  if (ledger && ledger.state !== "BLOCKED") {
    const complete = results.length === TARGETS[run.target_repo as keyof typeof TARGETS]?.length &&
      results.every((r) => r.status === "completed");
    if (complete && ledger.response !== null && ledger.state === "RUNNING") {
      const state = results.every((r) => r.conclusion === "success") ? "SUCCEEDED" : "FAILED";
      const { data: updated, error } = await supabaseAdmin.from("bridge_idempotency").update({ state, outcome_state: state,
        gh_runs: resolved as never, workflow_result: results as never,
        job_ids: results.map((r) => ({ repo: r.repo, ids: "job_ids" in r ? r.job_ids : [] })) as never,
        updated_at: new Date().toISOString(), finished_at: new Date().toISOString() })
        .eq("id", ledger.id).eq("state", "RUNNING").select("state").maybeSingle();
      if (error) return { status: 503, body: { error: "STATUS_STORE_UNAVAILABLE" } };
      currentState = updated?.state ?? ledger.state;
    }
  }
  const out = { id, target_repo: run.target_repo, gate: run.gate, dry_run: run.dry_run, runs: results,
    ...(ledger ? { idempotency_id: ledger.id, state: currentState } : {}) };
  await logCall(endpoint, key, { id }, 200, out);
  return { status: 200, body: out };
}

export function respond(status: number, body: unknown, request: Request) {
  const wantsText = new URL(request.url).searchParams.get("format") === "text";
  if (wantsText) {
    const text = Object.entries(body as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
      .join("\n");
    return new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}