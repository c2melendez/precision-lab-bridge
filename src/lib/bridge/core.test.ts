// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(), prepare: vi.fn(), begin: vi.fn(), record: vi.fn(), finish: vi.fn(), fetch: vi.fn(),
  statusFilters: [] as [string, string, unknown][],
  statusRows: { run: null as unknown, ledger: null as unknown },
}));
vi.mock("./idempotency.server", () => ({ claimRequest: mocks.claim, prepareRun: mocks.prepare,
  beginDispatch: mocks.begin, recordDispatch: mocks.record, finishClaim: mocks.finish }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: () => {
        const query = {
          eq: (column: string, value: unknown) => {
            if (table === "bridge_runs" || table === "bridge_idempotency") {
              mocks.statusFilters.push([table, column, value]);
            }
            return query;
          },
          maybeSingle: async () => ({
            data: table === "bridge_keys"
              ? { id: "key1", expires_at: "2099-01-01", revoked_at: null }
              : table === "bridge_runs"
                ? mocks.statusRows.run
                : table === "bridge_idempotency"
                  ? mocks.statusRows.ledger
                  : null,
            error: null,
          }),
        };
        return query;
      },
      update: () => ({ eq: async () => ({ error: null }) }),
      insert: async () => ({ error: null }),
    }),
  },
}));
import { runStatus, trigger } from "./core.server";

const raw = { target_repo: "lite", gate: "h1d", idempotency_key: "v1" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.statusFilters.length = 0;
  mocks.statusRows.run = null;
  mocks.statusRows.ledger = null;
  vi.stubGlobal("fetch", mocks.fetch);
});

describe("claim must precede every external dispatch", () => {
  it("does not dispatch without a durable claim", async () => {
    mocks.claim.mockRejectedValue(new Error("database failure with sensitive detail"));
    const result = await trigger("test", "plb_test", raw);
    expect(result.status).toBe(503);
    expect(JSON.stringify(result)).not.toContain("sensitive detail");
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("replays the exact existing receipt with no new dispatch", async () => {
    const body = { id: "run1", reused: false };
    mocks.claim.mockResolvedValue({ action: "replay", record: { http_status: 201, response: body } });
    expect(await trigger("test", "plb_test", raw)).toEqual({ status: 201, body });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("returns conflict for an incompatible fingerprint without dispatch", async () => {
    mocks.claim.mockResolvedValue({ action: "conflict" });
    expect((await trigger("test", "plb_test", { ...raw, target_repo: "plus" })).status).toBe(409);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("returns RUNNING for an active concurrent claim without dispatch", async () => {
    mocks.claim.mockResolvedValue({ action: "busy", record: { id: "claim1" } });
    const result = await trigger("test", "plb_test", raw);
    expect(result).toEqual({ status: 202, body: { idempotency_id: "claim1", state: "RUNNING", reused: true } });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("does not dispatch when a fenced intent cannot be durably saved", async () => {
    mocks.claim.mockResolvedValue({ action: "claimed", record: { id: "claim1", lease_token: "token1" } });
    mocks.prepare.mockResolvedValue("run1");
    mocks.begin.mockRejectedValue(new Error("CLAIM_NOT_OWNED"));
    expect((await trigger("test", "plb_test", raw)).status).toBe(503);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe("dispatch outcome handling", () => {
  const claimed = { action: "claimed", record: { id: "claim1", lease_token: "token1" } };
  beforeEach(() => {
    process.env["GH_TOKEN"] = "t";
    process.env["GH_OWNER"] = "o";
    process.env["GH_REF"] = "main";
    mocks.claim.mockResolvedValue(claimed);
    mocks.prepare.mockResolvedValue("run1");
    mocks.begin.mockResolvedValue(undefined);
  });
  it("registers the run located after a 204 dispatch", async () => {
    mocks.fetch.mockImplementation(async (url: string) =>
      String(url).includes("/dispatches")
        ? new Response(null, { status: 204 })
        : Response.json({ workflow_runs: [
            { id: 42, html_url: "u", created_at: new Date().toISOString(), head_branch: "main", head_sha: "x" },
          ] }));
    const r = await trigger("test", "plb_test", raw);
    expect(r.status).toBe(201);
    expect(mocks.record).toHaveBeenCalledWith(claimed.record, expect.objectContaining({ run_id: 42, html_url: "u" }));
    expect(mocks.finish).toHaveBeenCalledWith(claimed.record, "RUNNING", 201, expect.anything());
  });
  it("marks BLOCKED when the run cannot be located after a 204", async () => {
    mocks.fetch.mockImplementation(async (url: string) =>
      String(url).includes("/dispatches")
        ? new Response(null, { status: 204 })
        : Response.json({ workflow_runs: [] }));
    const r = await trigger("test", "plb_test", raw);
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: "DISPATCH_OUTCOME_UNKNOWN" });
    expect(mocks.finish).toHaveBeenCalledWith(claimed.record, "BLOCKED", 409, expect.anything(), "DISPATCH_OUTCOME_UNKNOWN");
  });
  it("fails definitively on a GitHub rejection without marking BLOCKED", async () => {
    mocks.fetch.mockResolvedValue(new Response("no", { status: 403 }));
    const r = await trigger("test", "plb_test", raw);
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ error: "GITHUB_DISPATCH_REJECTED_403" });
    expect(mocks.finish).toHaveBeenCalledWith(claimed.record, "FAILED", 502, expect.anything(), "GITHUB_DISPATCH_REJECTED_403");
  });
  it("treats network errors as uncertain and never retries blindly", async () => {
    mocks.fetch.mockRejectedValue(new Error("socket hangup"));
    const r = await trigger("test", "plb_test", raw);
    expect(r.status).toBe(409);
    expect(mocks.finish).toHaveBeenCalledWith(claimed.record, "BLOCKED", 409, expect.anything(), "DISPATCH_OUTCOME_UNKNOWN");
  });
});
describe("run status ownership", () => {
  it("scopes run lookup to the authenticated bridge key", async () => {
    const id = "00000000-0000-0000-0000-000000000001";
    const result = await runStatus("plb_test", id);

    expect(result).toEqual({ status: 404, body: { error: "not found" } });
    expect(mocks.statusFilters).toEqual([
      ["bridge_runs", "id", id],
      ["bridge_runs", "key_id", "key1"],
    ]);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe("run status ledger ownership", () => {
  it("scopes the idempotency ledger lookup to the same owner key", async () => {
    const id = "00000000-0000-0000-0000-000000000002";
    mocks.statusRows.run = {
      id,
      target_repo: "lite",
      gate: "h1d",
      dry_run: true,
      dispatched_at: "2026-10-30T00:00:00.000Z",
      gh_runs: [],
      key_id: "key1",
    };
    mocks.statusRows.ledger = {
      id: "ledger1",
      run_id: id,
      key_id: "key1",
      state: "BLOCKED",
      response: { idempotency_id: "ledger1" },
    };

    const result = await runStatus("plb_test", id);

    expect(result.status).toBe(200);
    expect(mocks.statusFilters).toEqual([
      ["bridge_runs", "id", id],
      ["bridge_runs", "key_id", "key1"],
      ["bridge_idempotency", "run_id", id],
      ["bridge_idempotency", "key_id", "key1"],
    ]);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
