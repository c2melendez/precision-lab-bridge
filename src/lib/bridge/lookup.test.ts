// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ select: vi.fn(), eq: vi.fn(), read: vi.fn(), fetch: vi.fn(),
  rpc: vi.fn(), insert: vi.fn(), update: vi.fn(), remove: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  from: () => ({ select: mocks.select, insert: mocks.insert, update: mocks.update, delete: mocks.remove }),
  rpc: mocks.rpc,
} }));
import { lookupRequest } from "./lookup.server";

const credential = { id: "key1", expires_at: "2099-01-01", revoked_at: null, scopes: ["read"] };
const record = { id: "claim1", state: "BLOCKED", outcome_state: "BLOCKED", run_id: "run1",
  gh_runs: [{ repo: "precision-lab-lite", run_id: 42, html_url: "https://github.com/c2melendez/precision-lab-lite/actions/runs/42" }],
  job_ids: [{ repo: "precision-lab-lite", ids: [84] }], error_code: "DISPATCH_OUTCOME_UNKNOWN",
  updated_at: "2026-10-28T02:00:00Z" };
const runningRecord = { ...record, state: "RUNNING", outcome_state: null, error_code: null };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  process.env["GH_TOKEN"] = "test-token";
  process.env["GH_OWNER"] = "c2melendez";
  const query = { eq: mocks.eq, maybeSingle: mocks.read, select: mocks.select };
  mocks.select.mockReturnValue(query);
  mocks.eq.mockReturnValue(query);
  mocks.update.mockReturnValue(query);
});

// The lookup never dispatches, never claims and never writes other records.
function expectNoDispatchOrClaims() {
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.insert).not.toHaveBeenCalled();
  expect(mocks.remove).not.toHaveBeenCalled();
  for (const call of mocks.fetch.mock.calls) {
    expect(String(call[0])).not.toContain("/dispatches");
    expect((call[1] as RequestInit | undefined)?.method ?? "GET").toBe("GET");
  }
}
function expectFullyReadOnly() {
  expectNoDispatchOrClaims();
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
}
function ghRuns(...runs: { status: string; conclusion: string | null }[]) {
  mocks.fetch.mockImplementation(async () => {
    const run = runs.shift();
    return { ok: true, json: async () => ({ ...run, html_url: "https://github.com/x/actions/runs/42" }) };
  });
}

describe("authenticated idempotency lookup is strictly read-only", () => {
  it("returns stored state, run IDs and URLs without dispatch or changing idempotency", async () => {
    mocks.read.mockResolvedValueOnce({ data: credential }).mockResolvedValueOnce({ data: record });
    const result = await lookupRequest("plb_test", "v1");
    expect(result).toEqual({ status: 200, body: { idempotency_id: "claim1", state: "BLOCKED", outcome_state: "BLOCKED",
      run_id: "run1", status_url: "/api/runs/run1", runs: record.gh_runs, job_ids: record.job_ids,
      error_code: "DISPATCH_OUTCOME_UNKNOWN", updated_at: record.updated_at } });
    expect(mocks.eq).toHaveBeenCalledWith("idempotency_key", "v1");
    expect(mocks.eq).toHaveBeenCalledWith("key_id", "key1");
    expectFullyReadOnly();
  });
  it("returns null IDs and URL before any run has been registered", async () => {
    mocks.read.mockResolvedValueOnce({ data: credential }).mockResolvedValueOnce({ data: { ...record,
      state: "RUNNING", outcome_state: null, run_id: null, gh_runs: [], job_ids: [], error_code: null } });
    expect(await lookupRequest("plb_test", "v1")).toMatchObject({ status: 200,
      body: { state: "RUNNING", run_id: null, status_url: null, runs: [] } });
    expectFullyReadOnly();
  });
  it("rejects a dispatch-only credential before reading idempotency data", async () => {
    mocks.read.mockResolvedValueOnce({ data: { ...credential, scopes: ["dispatch"] } });
    expect(await lookupRequest("plb_dispatch_only", "v1")).toEqual({
      status: 403, body: { error: "insufficient_scope", required_scope: "read" },
    });
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expectFullyReadOnly();
  });
  it("rejects missing authentication before reading storage", async () => {
    expect((await lookupRequest(null, "v1")).status).toBe(401);
    expect(mocks.select).not.toHaveBeenCalled();
    expectFullyReadOnly();
  });
  it.each([null, { ...credential, revoked_at: "2026-10-27" }, { ...credential, expires_at: "2020-01-01" }])(
    "rejects unknown, revoked or expired bridge keys", async (data) => {
      mocks.read.mockResolvedValueOnce({ data });
      expect((await lookupRequest("plb_test", "v1")).status).toBe(401);
      expect(mocks.read).toHaveBeenCalledTimes(1);
      expectFullyReadOnly();
    });
  it.each([null, "", "invalid key", "x".repeat(201)])("rejects absent or invalid Idempotency-Key", async (key) => {
    mocks.read.mockResolvedValueOnce({ data: credential });
    expect((await lookupRequest("plb_test", key)).status).toBe(400);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expectFullyReadOnly();
  });
  it("returns 404 for absent or other-credential requests without disclosing data", async () => {
    mocks.read.mockResolvedValueOnce({ data: credential }).mockResolvedValueOnce({ data: null });
    expect(await lookupRequest("plb_test", "other-owner")).toEqual({ status: 404, body: { error: "not found" } });
    expect(mocks.eq).toHaveBeenCalledWith("key_id", "key1");
    expectFullyReadOnly();
  });
  it.each(["authentication", "lookup"])("returns a nonsensitive error for unavailable %s storage", async (stage) => {
    if (stage === "lookup") mocks.read.mockResolvedValueOnce({ data: credential });
    mocks.read.mockResolvedValueOnce({ data: null, error: { message: "private detail" } });
    expect(await lookupRequest("plb_test", "v1")).toEqual({ status: 503, body: { error: "STATUS_STORE_UNAVAILABLE" } });
    expectFullyReadOnly();
  });
});

describe("RUNNING lookup reconciles GitHub run status like GET /api/runs/:id", () => {
  it("persists and returns SUCCEEDED when every run completed successfully", async () => {
    mocks.read.mockResolvedValueOnce({ data: credential }).mockResolvedValueOnce({ data: runningRecord })
      .mockResolvedValueOnce({ data: { state: "SUCCEEDED" } });
    ghRuns({ status: "completed", conclusion: "success" });
    const result = await lookupRequest("plb_test", "v1");
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ state: "SUCCEEDED", outcome_state: "SUCCEEDED" });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ state: "SUCCEEDED", outcome_state: "SUCCEEDED" }));
    expect(mocks.eq).toHaveBeenCalledWith("state", "RUNNING"); // conditional update never overwrites a final state
    expectNoDispatchOrClaims();
  });
  it("persists and returns FAILED when any completed run failed", async () => {
    mocks.read.mockResolvedValueOnce({ data: credential }).mockResolvedValueOnce({ data: runningRecord })
      .mockResolvedValueOnce({ data: { state: "FAILED" } });
    ghRuns({ status: "completed", conclusion: "failure" });
    const result = await lookupRequest("plb_test", "v1");
    expect(result.body).toMatchObject({ state: "FAILED", outcome_state: "FAILED" });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ state: "FAILED" }));
    expectNoDispatchOrClaims();
  });
  it("keeps RUNNING without writes while runs are still in progress", async () => {
    mocks.read.mockResolvedValueOnce({ data: credential }).mockResolvedValueOnce({ data: runningRecord });
    ghRuns({ status: "in_progress", conclusion: null });
    const result = await lookupRequest("plb_test", "v1");
    expect(result.body).toMatchObject({ state: "RUNNING", outcome_state: null });
    expect(mocks.update).not.toHaveBeenCalled();
    expectNoDispatchOrClaims();
  });
  it("keeps RUNNING without writes when runs lack registered IDs", async () => {
    mocks.read.mockResolvedValueOnce({ data: credential }).mockResolvedValueOnce({ data: { ...runningRecord,
      gh_runs: [{ repo: "precision-lab-lite", run_id: null, html_url: null }] } });
    const result = await lookupRequest("plb_test", "v1");
    expect(result.body).toMatchObject({ state: "RUNNING" });
    expectFullyReadOnly();
  });
  it("returns the stored state unchanged when GitHub fails", async () => {
    mocks.read.mockResolvedValueOnce({ data: credential }).mockResolvedValueOnce({ data: runningRecord });
    mocks.fetch.mockRejectedValue(new Error("network down"));
    const result = await lookupRequest("plb_test", "v1");
    expect(result.body).toMatchObject({ state: "RUNNING", outcome_state: null, runs: runningRecord.gh_runs });
    expect(mocks.update).not.toHaveBeenCalled();
    expectNoDispatchOrClaims();
  });
  it("returns the stored state unchanged when GitHub responds with an error status", async () => {
    mocks.read.mockResolvedValueOnce({ data: credential }).mockResolvedValueOnce({ data: runningRecord });
    mocks.fetch.mockResolvedValue({ ok: false, status: 500 });
    const result = await lookupRequest("plb_test", "v1");
    expect(result.body).toMatchObject({ state: "RUNNING" });
    expect(mocks.update).not.toHaveBeenCalled();
    expectNoDispatchOrClaims();
  });
  it("keeps the stored state when the conditional update loses the race to another writer", async () => {
    mocks.read.mockResolvedValueOnce({ data: credential }).mockResolvedValueOnce({ data: runningRecord })
      .mockResolvedValueOnce({ data: null }); // no row matched state = RUNNING
    ghRuns({ status: "completed", conclusion: "success" });
    const result = await lookupRequest("plb_test", "v1");
    expect(result.body).toMatchObject({ state: "RUNNING" });
    expectNoDispatchOrClaims();
  });
  it("never queries GitHub or writes for states that are already final", async () => {
    mocks.read.mockResolvedValueOnce({ data: credential }).mockResolvedValueOnce({ data: { ...record,
      state: "SUCCEEDED", outcome_state: "SUCCEEDED", error_code: null } });
    const result = await lookupRequest("plb_test", "v1");
    expect(result.body).toMatchObject({ state: "SUCCEEDED", outcome_state: "SUCCEEDED" });
    expectFullyReadOnly();
  });
});