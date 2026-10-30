// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  keysByHash: {} as Record<string, { id: string; expires_at: string; revoked_at: string | null; scopes: string[] }>,
  run: null as null | Record<string, unknown>,
  ledger: null as null | Record<string, unknown>,
  filters: [] as Array<[string, string, unknown]>,
  keyReadError: false,
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: () => {
        const filters: Array<[string, unknown]> = [];
        const query = {
          eq: (column: string, value: unknown) => { filters.push([column, value]); mocks.filters.push([table, column, value]); return query; },
          maybeSingle: async () => {
            if (table === "bridge_keys") {
              if (mocks.keyReadError) return { data: null, error: { message: "private database detail" } };
              const hash = filters.find(([column]) => column === "key_hash")?.[1];
              return { data: mocks.keysByHash[String(hash)] ?? null, error: null };
            }
            const owner = filters.find(([column]) => column === "key_id")?.[1];
            if (table === "bridge_runs") return { data: mocks.run?.key_id === owner ? mocks.run : null, error: null };
            if (table === "bridge_idempotency") return { data: mocks.ledger?.key_id === owner ? mocks.ledger : null, error: null };
            return { data: null, error: null };
          },
        };
        return query;
      },
      update: () => ({ eq: async () => ({ error: null }) }),
      insert: async () => ({ error: null }),
    }),
  },
}));
vi.mock("./idempotency.server", () => ({
  claimRequest: vi.fn(), prepareRun: vi.fn(), beginDispatch: vi.fn(), recordDispatch: vi.fn(), finishClaim: vi.fn(),
}));
import { runStatus, sha256 } from "./core.server";
const keyA = "plb_owner_a_test_only", keyB = "plb_owner_b_test_only";
const runId = "00000000-0000-0000-0000-000000000042";
beforeAll(async () => {
  mocks.keysByHash[await sha256(keyA)] = { id: "owner-a", expires_at: "2099-01-01T00:00:00.000Z", revoked_at: null, scopes: ["read"] };
  mocks.keysByHash[await sha256(keyB)] = { id: "owner-b", expires_at: "2099-01-01T00:00:00.000Z", revoked_at: null, scopes: ["read"] };
});
beforeEach(() => {
  vi.clearAllMocks(); mocks.filters.length = 0; mocks.keyReadError = false;
  mocks.run = { id: runId, target_repo: "lite", gate: "h1d", dry_run: true, dispatched_at: "2026-10-30T00:00:00.000Z", gh_runs: [], key_id: "owner-b" };
  mocks.ledger = { id: "ledger-owner-b", run_id: runId, key_id: "owner-b", state: "BLOCKED", response: { idempotency_id: "ledger-owner-b" } };
  vi.stubGlobal("fetch", vi.fn());
});
describe("Bridge credential ownership isolation", () => {
  it("returns the same 404 for a run owned by another credential", async () => {
    const result = await runStatus(keyA, runId);
    expect(result).toEqual({ status: 404, body: { error: "not found" } });
    expect(mocks.filters).toContainEqual(["bridge_runs", "key_id", "owner-a"]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("allows the owning credential to read its run and ledger", async () => {
    const result = await runStatus(keyB, runId);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ id: runId, idempotency_id: "ledger-owner-b", state: "BLOCKED" });
    expect(mocks.filters).toContainEqual(["bridge_runs", "key_id", "owner-b"]);
    expect(mocks.filters).toContainEqual(["bridge_idempotency", "key_id", "owner-b"]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("does not expose a ledger attached to a different credential", async () => {
    mocks.ledger = { ...mocks.ledger, key_id: "owner-a", id: "ledger-owner-a" };
    const result = await runStatus(keyB, runId);
    expect(result.status).toBe(200);
    expect(result.body).not.toHaveProperty("idempotency_id");
    expect(result.body).not.toHaveProperty("state");
    expect(JSON.stringify(result.body)).not.toContain("ledger-owner-a");
  });
  it("fails closed with 503 when credential storage is unavailable", async () => {
    mocks.keyReadError = true;
    const result = await runStatus(keyB, runId);
    expect(result).toEqual({ status: 503, body: { error: "AUTH_STORE_UNAVAILABLE" } });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
