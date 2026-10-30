// Read-only administrative inspection of three historical RUNNING requests owned
// by a revoked bridge key. Strictly SELECT on storage and GET on GitHub: it never
// writes, never calls RPCs, never dispatches and never persists a reconciled state.
// Deliberately imports nothing from core/idempotency/lookup server modules.
import { z } from "zod";

export const HISTORY_ALLOWED_RUN_IDS: readonly number[] = Object.freeze([40461232174, 40461306085, 40463419492]);
export const HISTORY_ALLOWED_REPOS: readonly string[] = Object.freeze(["precision-lab-lite", "precision-lab-plus"]);

export const historyInput = z.object({
  password: z.string().min(1).max(200),
  run_id: z.number().int().positive(),
}).strict();

type Observed = "SUCCEEDED" | "FAILED" | "RUNNING" | "UNKNOWN";
type GhRun = { repo?: unknown; run_id?: unknown; html_url?: unknown };
export type HistoryResult =
  | { ok: false; error: "UNAUTHORIZED" | "INVALID_INPUT" | "NOT_FOUND" | "STATUS_STORE_UNAVAILABLE" }
  | { ok: true; idempotency_id: string; stored_state: string; observed_state: Observed; persisted: false;
      run_id: string | null;
      runs: { repo: string; run_id: number; status: string | null; conclusion: string | null; url: string | null }[];
      created_at: string; updated_at: string };

function log(decision: string, runId: number | null, extra: Record<string, unknown> = {}) {
  console.info(JSON.stringify({ event: "admin_history_read", at: new Date().toISOString(), run_id: runId, decision, ...extra }));
}

async function digest(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function passwordOk(input: string): Promise<boolean> {
  const expected = process.env["BRIDGE_ADMIN_PASSWORD"];
  if (!expected) return false;
  const [a, b] = await Promise.all([digest(input), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0 && a.length === b.length;
}

async function ghGetRun(repo: string, runId: number) {
  const token = process.env["GH_TOKEN"];
  const owner = process.env["GH_OWNER"];
  // Defense in depth: never build a URL for a repo or run ID outside the allowlists.
  if (!token || !owner || !HISTORY_ALLOWED_REPOS.includes(repo) || !HISTORY_ALLOWED_RUN_IDS.includes(runId)) {
    throw new Error("unavailable");
  }
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}`, {
    method: "GET",
    signal: AbortSignal.timeout(30_000),
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "precision-lab-bridge-history" },
  });
  if (!res.ok) throw new Error("unavailable");
  const j = (await res.json()) as { status?: string; conclusion?: string | null; html_url?: string };
  return { status: j.status ?? null, conclusion: j.conclusion ?? null, url: j.html_url ?? null };
}

export async function inspectHistoricalRun(raw: unknown): Promise<HistoryResult> {
  const parsed = historyInput.safeParse(raw);
  if (!parsed.success) { log("invalid_input", null); return { ok: false, error: "INVALID_INPUT" }; }
  const { password, run_id } = parsed.data;
  if (!(await passwordOk(password))) { log("denied_auth", null); return { ok: false, error: "UNAUTHORIZED" }; }
  if (!HISTORY_ALLOWED_RUN_IDS.includes(run_id)) { log("denied_allowlist", run_id); return { ok: false, error: "NOT_FOUND" }; }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: rows, error } = await supabaseAdmin.from("bridge_idempotency")
    .select("id, key_id, state, run_id, gh_runs, created_at, updated_at")
    .contains("gh_runs", [{ run_id }]).eq("state", "RUNNING").limit(2);
  if (error) { log("store_unavailable", run_id); return { ok: false, error: "STATUS_STORE_UNAVAILABLE" }; }
  if (!rows || rows.length !== 1) { log("not_found", run_id); return { ok: false, error: "NOT_FOUND" }; }
  const row = rows[0]!;
  if (row.state !== "RUNNING" || !row.key_id) { log("not_found", run_id); return { ok: false, error: "NOT_FOUND" }; }

  // Only id and revoked_at are selected: no key prefix, hash or other credential
  // material ever leaves the store through this inspection.
  const { data: key, error: keyError } = await supabaseAdmin.from("bridge_keys")
    .select("id, revoked_at").eq("id", row.key_id).maybeSingle();
  if (keyError) { log("store_unavailable", run_id); return { ok: false, error: "STATUS_STORE_UNAVAILABLE" }; }
  if (!key || !key.revoked_at) { log("not_found", run_id); return { ok: false, error: "NOT_FOUND" }; }

  // Every stored entry must be an allowlisted repo AND run ID, and the requested run
  // must be among them; otherwise nothing is fetched and no run details are returned.
  const stored = (Array.isArray(row.gh_runs) ? row.gh_runs : []) as GhRun[];
  const entries = stored.every((r) => typeof r?.repo === "string" && HISTORY_ALLOWED_REPOS.includes(r.repo)
    && typeof r?.run_id === "number" && HISTORY_ALLOWED_RUN_IDS.includes(r.run_id))
    ? stored.map((r) => ({ repo: r.repo as string, run_id: r.run_id as number })) : [];
  if (entries.length === 0 || !entries.some((r) => r.run_id === run_id)) {
    log("not_found", run_id); return { ok: false, error: "NOT_FOUND" };
  }
  let observed: Observed = "UNKNOWN";
  let runs: Extract<HistoryResult, { ok: true }>["runs"] = entries.map((r) => ({ ...r, status: null, conclusion: null, url: null }));
  try {
    runs = await Promise.all(entries.map(async (r) => ({ ...r, ...(await ghGetRun(r.repo, r.run_id)) })));
    observed = !runs.every((r) => r.status === "completed") ? "RUNNING"
      : runs.every((r) => r.conclusion === "success") ? "SUCCEEDED" : "FAILED";
  } catch {
    observed = "UNKNOWN";
    runs = entries.map((r) => ({ ...r, status: null, conclusion: null, url: null }));
  }
  log("allowed", run_id, { stored_state: row.state, observed_state: observed });
  return { ok: true, idempotency_id: row.id, stored_state: row.state, observed_state: observed, persisted: false,
    run_id: row.run_id, runs, created_at: row.created_at, updated_at: row.updated_at };
}