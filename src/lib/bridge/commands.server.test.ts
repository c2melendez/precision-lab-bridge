// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkKey: vi.fn(),
  fetchObserverStatus: vi.fn(),
  fetchObserverGatePlan: vi.fn(),
  rpc: vi.fn(),
  keyScopes: ["command:submit", "command:read", "context:read"] as string[],
  existingContext: null as Record<string, unknown> | null,
  commandRecord: null as Record<string, unknown> | null,
  ownerId: "owner-a",
  insertedAudit: [] as unknown[],
  filters: [] as Array<[string, string, unknown]>,
}));

vi.mock("./core.server", () => ({
  checkKey: mocks.checkKey,
  prefixOf: (key: string) => key.slice(0, 10),
}));

vi.mock("./observer.server", () => ({
  fetchObserverStatus: mocks.fetchObserverStatus,
  fetchObserverGatePlan: mocks.fetchObserverGatePlan,
  ObserverError: class ObserverError extends Error {
    constructor(public code: string, public httpStatus: number) { super(code); }
  },
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: mocks.rpc,
    from: (table: string) => {
      if (table === "bridge_calls") {
        return {
          insert: async (value: unknown) => {
            mocks.insertedAudit.push(value);
            return { error: null };
          },
        };
      }
      const filters: Record<string, unknown> = {};
      const query: {
        select: (columns?: string) => typeof query;
        eq: (column: string, value: unknown) => typeof query;
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: null }>;
      } = {
        select: () => query,
        eq: (column, value) => {
          filters[column] = value;
          mocks.filters.push([table, column, value]);
          return query;
        },
        maybeSingle: async () => {
          if (table !== "bridge_commands") return { data: null, error: null };
          if (filters["idempotency_key"] !== undefined) {
            return {
              data: filters["key_id"] === mocks.ownerId && mocks.existingContext
                ? { observer_context: mocks.existingContext } : null,
              error: null,
            };
          }
          const record = mocks.commandRecord;
          return {
            data: record && record["key_id"] === filters["key_id"] &&
              (filters["id"] === undefined || record["id"] === filters["id"]) &&
              (filters["idempotency_key"] === undefined || record["idempotency_key"] === filters["idempotency_key"])
              ? record : null,
            error: null,
          };
        },
      };
      return query;
    },
  },
}));

import {
  getCapabilities,
  getCommand,
  getContextStatus,
  lookupCommand,
  submitCommand,
} from "./commands.server";

const sha = "b".repeat(40);
const body = {
  schema_version: 1,
  command_type: "repo.inspect",
  target_repo: "lite",
  expected_branch: "qa/syntax-audit-in625-a1",
  expected_sha: sha,
  payload: {},
  idempotency_key: "m1-submit-1",
  correlation_id: "corr-1",
  validation_id: "val-1",
};
const observer = {
  served_at: "2026-10-30T18:00:00.000Z",
  read_only: true as const,
  repositories: [{
    repo: "lite" as const,
    repository_full_name: "c2melendez/precision-lab-lite",
    canonical_branch: "qa/syntax-audit-in625-a1",
    current_head_sha: sha,
    state_status: "CURRENT" as const,
    continuity_revision: 4,
  }],
};
const record = {
  id: "00000000-0000-4000-8000-000000000001",
  key_id: "owner-a",
  idempotency_key: body.idempotency_key,
  command_type: "repo.inspect",
  target_repo: "lite",
  expected_branch: body.expected_branch,
  expected_sha: sha,
  status: "accepted",
  correlation_id: "corr-1",
  validation_id: "val-1",
  created_at: "2026-10-30T18:00:00.000Z",
  updated_at: "2026-10-30T18:00:00.000Z",
  replay_count: 0,
  attempt_count: 0,
  completed_at: null,
  error_code: null,
  actions_run_id: null,
  commit_sha: null,
  pull_request_number: null,
  pull_request_url: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.keyScopes = ["command:submit", "command:read", "context:read"];
  mocks.existingContext = null;
  mocks.commandRecord = null;
  mocks.ownerId = "owner-a";
  mocks.insertedAudit.length = 0;
  mocks.filters.length = 0;
  mocks.checkKey.mockImplementation(async () => ({
    id: mocks.ownerId,
    expires_at: "2099-01-01T00:00:00.000Z",
    revoked_at: null,
    scopes: mocks.keyScopes,
  }));
  mocks.fetchObserverStatus.mockResolvedValue(observer);
  mocks.fetchObserverGatePlan.mockResolvedValue({ read_only: true, action_taken: false });
  mocks.rpc.mockResolvedValue({ data: { action: "accepted", record }, error: null });
});

describe("M1 command submission service", () => {
  it("authenticates, checks live Observer HEAD and accepts one durable record", async () => {
    const result = await submitCommand("POST /api/v1/commands", "plb_test_key", body, body.idempotency_key);
    expect(result.status).toBe(202);
    expect(result.body).toMatchObject({
      command_id: record.id,
      status: "accepted",
      execution_enabled: false,
    });
    expect(mocks.fetchObserverStatus).toHaveBeenCalledWith("lite");
    expect(mocks.rpc).toHaveBeenCalledWith("bridge_submit_command", expect.objectContaining({
      p_key_id: "owner-a",
      p_idempotency_key: body.idempotency_key,
      p_expected_branch: body.expected_branch,
      p_expected_sha: sha,
    }));
    expect(mocks.insertedAudit).toHaveLength(1);
    expect(JSON.stringify(mocks.insertedAudit)).not.toContain("plb_test_key");
  });

  it("does not grant command scope to a legacy read/dispatch key", async () => {
    mocks.keyScopes = ["read", "dispatch"];
    const result = await submitCommand("POST /api/v1/commands", "plb_legacy", body, body.idempotency_key);
    expect(result).toMatchObject({ status: 403, body: { required_scope: "command:submit" } });
    expect(mocks.fetchObserverStatus).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a stale expected SHA before persistence", async () => {
    const result = await submitCommand(
      "POST /api/v1/commands", "plb_test_key", { ...body, expected_sha: "c".repeat(40) }, body.idempotency_key,
    );
    expect(result).toMatchObject({
      status: 409,
      body: { error: "STALE_EXPECTED_HEAD", current_head_sha: sha },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects Observer states requiring reconciliation before persistence", async () => {
    mocks.fetchObserverStatus.mockResolvedValue({
      ...observer,
      repositories: [{ ...observer.repositories[0], state_status: "RECONCILE" }],
    });
    const result = await submitCommand("POST /api/v1/commands", "plb_test_key", body, body.idempotency_key);
    expect(result).toMatchObject({
      status: 409,
      body: { error: "OBSERVER_STATE_REQUIRES_RECONCILIATION" },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps Observer outage to a bounded safe error and does not persist", async () => {
    mocks.fetchObserverStatus.mockRejectedValue(new Error("sensitive upstream detail"));
    const result = await submitCommand("POST /api/v1/commands", "plb_test_key", body, body.idempotency_key);
    expect(result).toEqual({ status: 503, body: { error: "OBSERVER_UNAVAILABLE" } });
    expect(JSON.stringify(result)).not.toContain("sensitive upstream detail");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("replays an existing owner's receipt without depending on the current Observer HEAD", async () => {
    mocks.existingContext = { canonical_branch: "qa/syntax-audit-in625-a1", current_head_sha: sha };
    const storedReceipt = {
      command_id: record.id, command_type: record.command_type, target_repo: record.target_repo,
      expected_branch: record.expected_branch, expected_sha: record.expected_sha, status: record.status,
      correlation_id: record.correlation_id, validation_id: record.validation_id,
      created_at: record.created_at, updated_at: record.updated_at, replay_count: 0, execution_enabled: false,
    };
    mocks.rpc.mockResolvedValue({ data: { action: "replay", record: { ...record, replay_count: 1, response: storedReceipt } }, error: null });
    const result = await submitCommand("POST /api/v1/commands", "plb_test_key", body, body.idempotency_key);
    expect(result).toEqual({ status: 200, body: storedReceipt });
    expect(mocks.fetchObserverStatus).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("returns 409 on a same-key different fingerprint replay", async () => {
    mocks.existingContext = { canonical_branch: "qa/syntax-audit-in625-a1", current_head_sha: sha };
    mocks.rpc.mockResolvedValue({ data: { action: "conflict" }, error: null });
    const result = await submitCommand(
      "POST /api/v1/commands", "plb_test_key",
      { ...body, command_type: "repo.validate", payload: { profile: "unit" } },
      body.idempotency_key,
    );
    expect(result).toEqual({ status: 409, body: { error: "IDEMPOTENCY_CONFLICT" } });
    expect(mocks.fetchObserverStatus).not.toHaveBeenCalled();
  });

  it("maps a database failure without leaking the raw error", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "private SQL detail" } });
    const result = await submitCommand("POST /api/v1/commands", "plb_test_key", body, body.idempotency_key);
    expect(result).toEqual({ status: 503, body: { error: "COMMAND_STORE_UNAVAILABLE" } });
    expect(JSON.stringify(result)).not.toContain("private SQL detail");
  });
});

describe("M1 command receipt ownership and context scopes", () => {
  const commandId = record.id;
  it("returns the same 404 for missing and foreign-owned command records", async () => {
    mocks.keyScopes = ["command:read"];
    mocks.ownerId = "owner-a";
    mocks.commandRecord = { ...record, key_id: "owner-b" };
    const result = await getCommand("plb_key_a", commandId);
    expect(result).toEqual({ status: 404, body: { error: "not found" } });
    expect(mocks.filters).toContainEqual(["bridge_commands", "key_id", "owner-a"]);
    expect(mocks.filters).toContainEqual(["bridge_commands", "id", commandId]);
  });

  it("denies receipt reads without command:read", async () => {
    mocks.keyScopes = ["read", "dispatch"];
    const result = await getCommand("plb_legacy", commandId);
    expect(result).toMatchObject({ status: 403, body: { required_scope: "command:read" } });
  });

  it("requires context:read for capabilities and Observer context", async () => {
    mocks.keyScopes = ["command:submit"];
    expect((await getCapabilities("plb_submit_only")).status).toBe(403);
    expect((await getContextStatus("plb_submit_only", "lite")).status).toBe(403);
    expect(mocks.fetchObserverStatus).not.toHaveBeenCalled();
  });
});
