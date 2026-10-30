// @vitest-environment node
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { trigger, runStatus, sha256 } from "./core.server";
import { claimRequest, prepareRun, beginDispatch } from "./idempotency.server";
import type { IdempotentRequest } from "./idempotency";

// Database-only fixtures. No actual GitHub HTTP request can leave this test process.
const configured = Boolean(process.env["SUPABASE_URL"] && process.env["SUPABASE_SERVICE_ROLE_KEY"]);
const prefix = `phase3-test:${crypto.randomUUID()}`;
const bridgeKey = `plb_${crypto.randomUUID().replaceAll("-", "")}`;
let keyId = "";
let receiptId = "";
const nativeFetch = globalThis.fetch;
const dispatch = vi.fn(async (_url: string) => Response.json({ workflow_run_id: 12345, html_url: "https://github.com/example/test/actions/runs/12345" }));
const request = (suffix: string): IdempotentRequest => ({ target_repo: "lite", gate: "h1d", dry_run: true,
  idempotency_key: `${prefix}:${suffix}`, validation_id: `${prefix}:validation`, correlation_id: `${prefix}:correlation`,
  branch: "main", requested_sha: "a".repeat(40) });

describe.skipIf(!configured)("real Cloud idempotency, no real workflows", () => {
  beforeAll(async () => {
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url).hostname === "api.github.com") return dispatch(url);
      return nativeFetch(input, init);
    });
    const { data, error } = await supabaseAdmin.from("bridge_keys").insert({ label: prefix, key_hash: await sha256(bridgeKey),
      key_prefix: bridgeKey.slice(0, 10), scopes: ["read", "dispatch"],
      expires_at: new Date(Date.now() + 600_000).toISOString() }).select("id").single();
    if (error || !data) throw new Error("Unable to create isolated database test fixture");
    keyId = data.id;
    process.env["GH_OWNER"] ||= "test-owner";
    process.env["GH_TOKEN"] ||= "mock-transport-only";
  }, 30_000);

  afterAll(async () => {
    const { data } = await supabaseAdmin.from("bridge_idempotency").select("run_id").like("idempotency_key", `${prefix}%`);
    const runIds = (data ?? []).flatMap((r) => r.run_id ? [r.run_id] : []);
    await supabaseAdmin.from("bridge_idempotency").delete().like("idempotency_key", `${prefix}%`);
    if (runIds.length) await supabaseAdmin.from("bridge_runs").delete().in("id", runIds);
    await supabaseAdmin.from("bridge_calls").delete().eq("key_prefix", bridgeKey.slice(0, 10));
    if (keyId) await supabaseAdmin.from("bridge_keys").delete().eq("id", keyId);
    vi.unstubAllGlobals();
  });

  it("enforces the unique constraint in the real database", async () => {
    const p = request("unique");
    const claim = await claimRequest(keyId, p, sha256);
    expect(claim.action).toBe("claimed");
    const { error } = await supabaseAdmin.from("bridge_idempotency").insert({
      idempotency_key: p.idempotency_key, key_id: keyId, validation_id: p.validation_id, correlation_id: p.correlation_id,
      repo: p.target_repo, branch: p.branch, request_fingerprint: "a".repeat(64), request_payload: {},
      lease_token: crypto.randomUUID(), lease_expires_at: new Date(Date.now() + 120_000).toISOString(),
    });
    expect(error?.code).toBe("23505");
  });

  it("gives exactly one owner to eight simultaneous claims", async () => {
    const claims = await Promise.all(Array.from({ length: 8 }, () => claimRequest(keyId, request("concurrent"), sha256)));
    expect(claims.filter((c) => c.action === "claimed")).toHaveLength(1);
    expect(claims.filter((c) => c.action === "busy")).toHaveLength(7);
  });

  it("replays the stored HTTP receipt without another simulated dispatch", async () => {
    const p = request("receipt");
    const first = await trigger(prefix, bridgeKey, p);
    expect(first.status).toBe(201);
    const count = dispatch.mock.calls.length;
    const second = await trigger(prefix, bridgeKey, p);
    expect(second).toEqual(first);
    expect(dispatch.mock.calls.length).toBe(count);
    expect(count).toBe(1);
    const { data } = await supabaseAdmin.from("bridge_idempotency").select("id,gh_runs,started_at").eq("idempotency_key", p.idempotency_key).single();
    expect(data?.started_at).toBeTruthy();
    expect(data?.gh_runs).toEqual([{ repo: "precision-lab-lite", run_id: 12345,
      html_url: "https://github.com/example/test/actions/runs/12345" }]);
    receiptId = data?.id ?? "";
  });

  it("conflicts on a changed SHA or gate without another simulated dispatch", async () => {
    const count = dispatch.mock.calls.length;
    for (const change of [{ requested_sha: "b".repeat(40) }, { gate: "security" }]) {
      const result = await trigger(prefix, bridgeKey, { ...request("receipt"), ...change });
      expect(result.status).toBe(409);
      expect(result.body).toEqual({ error: "IDEMPOTENCY_CONFLICT" });
    }
    expect(dispatch.mock.calls.length).toBe(count);
  });

  it("persists the receipt across a fresh server process", async () => {
    expect(receiptId).not.toBe("");
    const script = `import { supabaseAdmin } from './src/integrations/supabase/client.server.ts';
      const {data,error}=await supabaseAdmin.from('bridge_idempotency').select('id,response,request_fingerprint').eq('id',process.argv[1]).single();
      if(error) process.exit(2); console.log(JSON.stringify(data));`;
    const output = execFileSync("bun", ["-e", script, receiptId], { cwd: process.cwd(), encoding: "utf8", timeout: 30_000 });
    const persisted = JSON.parse(output);
    const { data } = await supabaseAdmin.from("bridge_idempotency").select("id,response,request_fingerprint").eq("id", receiptId).single();
    expect(persisted).toEqual(data);
  });

  it("recovers an expired pre-dispatch lease and fences the old owner", async () => {
    const first = await claimRequest(keyId, request("recover"), sha256);
    if (first.action !== "claimed") throw new Error("Expected owned claim");
    await supabaseAdmin.from("bridge_idempotency").update({ lease_expires_at: "2000-01-01" }).eq("id", first.record.id);
    const second = await claimRequest(keyId, request("recover"), sha256);
    if (second.action !== "claimed") throw new Error("Expected recovered claim");
    expect(second.record.lease_token).not.toBe(first.record.lease_token);
    expect(second.record.attempt_count).toBe(2);
    await expect(prepareRun(first.record)).rejects.toThrow("PREPARE_FAILED");
    expect(await prepareRun(second.record)).toBeTruthy();
  });

  it("blocks an expired uncertain intent and never authorizes a retry", async () => {
    const first = await claimRequest(keyId, request("uncertain"), sha256);
    if (first.action !== "claimed") throw new Error("Expected owned claim");
    await prepareRun(first.record);
    await beginDispatch(first.record, "precision-lab-lite");
    // Intent only: do NOT actually dispatch.
    await supabaseAdmin.from("bridge_idempotency").update({ lease_expires_at: "2000-01-01" }).eq("id", first.record.id);
    const recovered = await claimRequest(keyId, request("uncertain"), sha256);
    expect(recovered.action).toBe("replay");
    if (recovered.action === "replay") expect(recovered.record.state).toBe("BLOCKED");
    await expect(beginDispatch(first.record, "precision-lab-lite")).rejects.toThrow("CLAIM_NOT_OWNED");
  });

  it("rejects malformed null leases at the database boundary", async () => {
    const p = request("null-lease");
    const claim = await claimRequest(keyId, p, sha256);
    if (claim.action !== "claimed") throw new Error("Expected claim");
    const { error } = await supabaseAdmin.from("bridge_idempotency").update({ lease_token: null, lease_expires_at: null }).eq("id", claim.record.id);
    expect(error?.code).toBe("23514");
  });

  it("blocks missing GitHub run IDs without a misleading successful receipt", async () => {
    dispatch.mockImplementationOnce(async () => new Response(null, { status: 204 }));
    const p = request("no-id");
    const first = await trigger(prefix, bridgeKey, p);
    expect(first.status).toBe(409);
    const count = dispatch.mock.calls.length;
    expect(await trigger(prefix, bridgeKey, p)).toEqual(first);
    expect(dispatch.mock.calls.length).toBe(count);
    const { data } = await supabaseAdmin.from("bridge_idempotency").select("state").eq("idempotency_key", p.idempotency_key).single();
    expect(data?.state).toBe("BLOCKED");
  });

  it("preserves partial both progress and never retries either repository", async () => {
    dispatch.mockImplementationOnce(async () => Response.json({ workflow_run_id: 12345 }))
      .mockImplementationOnce(async () => { throw new Error("simulated lost response"); });
    const p = { ...request("partial"), target_repo: "both" } as IdempotentRequest;
    const first = await trigger(prefix, bridgeKey, p);
    expect(first.status).toBe(409);
    const count = dispatch.mock.calls.length;
    expect(await trigger(prefix, bridgeKey, p)).toEqual(first);
    expect(dispatch.mock.calls.length).toBe(count);
    const { data } = await supabaseAdmin.from("bridge_idempotency").select("state,gh_runs,dispatch_intents").eq("idempotency_key", p.idempotency_key).single();
    expect(data?.state).toBe("BLOCKED");
    expect(data?.gh_runs).toHaveLength(1);
    expect(data?.dispatch_intents).toEqual({ "precision-lab-lite": "ACCEPTED", "precision-lab-plus": "STARTED" });
  });

  it("stores completed outcomes and job IDs, then replays as REPLAYED without losing the receipt", async () => {
    const { data: ledger } = await supabaseAdmin.from("bridge_idempotency").select("run_id,response").eq("id", receiptId).single();
    if (!ledger?.run_id) throw new Error("Missing test run");
    dispatch.mockImplementationOnce(async () => Response.json({ status: "completed", conclusion: "success", html_url: "https://github.com/example/test/actions/runs/12345" }))
      .mockImplementationOnce(async () => Response.json({ jobs: [{ id: 67890 }] }));
    const status = await runStatus(bridgeKey, ledger.run_id);
    expect(status.status).toBe(200);
    const { data: completed } = await supabaseAdmin.from("bridge_idempotency").select("state,finished_at,job_ids,workflow_result").eq("id", receiptId).single();
    expect(completed?.state).toBe("SUCCEEDED");
    expect(completed?.finished_at).toBeTruthy();
    expect(completed?.job_ids).toEqual([{ repo: "precision-lab-lite", ids: [67890] }]);
    expect(completed?.workflow_result).toHaveLength(1);
    const count = dispatch.mock.calls.length;
    const replay = await trigger(prefix, bridgeKey, request("receipt"));
    expect(replay.body).toEqual(ledger.response);
    expect(dispatch.mock.calls.length).toBe(count);
    const { data: replayed } = await supabaseAdmin.from("bridge_idempotency").select("state,outcome_state,response").eq("id", receiptId).single();
    expect(replayed?.state).toBe("REPLAYED");
    expect(replayed?.outcome_state).toBe("SUCCEEDED");
    expect(replayed?.response).toEqual(ledger.response);
  });

  it("records a failed workflow conclusion without changing the dispatch receipt", async () => {
    const p = request("failed-workflow");
    const first = await trigger(prefix, bridgeKey, p);
    expect(first.status).toBe(201);
    const { data: ledger } = await supabaseAdmin.from("bridge_idempotency").select("id,run_id,response").eq("idempotency_key", p.idempotency_key).single();
    if (!ledger?.run_id) throw new Error("Missing test run");
    dispatch.mockImplementationOnce(async () => Response.json({ status: "completed", conclusion: "failure", html_url: "https://github.com/example/test/actions/runs/12345" }))
      .mockImplementationOnce(async () => Response.json({ jobs: [] }));
    await runStatus(bridgeKey, ledger.run_id);
    const { data } = await supabaseAdmin.from("bridge_idempotency").select("state,response").eq("id", ledger.id).single();
    expect(data?.state).toBe("FAILED");
    expect(data?.response).toEqual(ledger.response);
  });

  it("denies anonymous access to the ledger and claim RPC", async () => {
    const url = process.env["SUPABASE_URL"];
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
    if (!url || !key) throw new Error("Missing public client configuration for privilege test");
    const publicClient = createClient(url, key, { auth: { persistSession: false }, global: { fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) headers.delete("Authorization");
      headers.set("apikey", key);
      return nativeFetch(input, { ...init, headers });
    } } });
    const { error } = await publicClient.from("bridge_idempotency").select("id");
    expect(error).not.toBeNull();
    const rpc = await publicClient.rpc("bridge_claim", { p_key: `${prefix}:anon`, p_key_id: keyId, p_fingerprint: "a".repeat(64),
      p_payload: {}, p_validation_id: "v", p_correlation_id: "c", p_repo: "lite", p_branch: "main", p_sha: null });
    expect(rpc.error).not.toBeNull();
  });
});