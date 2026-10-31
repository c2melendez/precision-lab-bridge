// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  args: [] as Array<{ name: string; args: Record<string, unknown> }>,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: async (name: string, args: Record<string, unknown>) => {
      mocks.args.push({ name, args });
      return mocks.rpc(name, args);
    },
  },
}));

import { claimRunnerCommand, finishRunnerCommand } from "./runner.server";
import type { VerifiedRunnerIdentity } from "./runner-oidc.server";

const commandId = "00000000-0000-4000-8000-000000000001";
const identity: VerifiedRunnerIdentity = {
  repository: "c2melendez/precision-lab-lite",
  repositoryId: "1342436850",
  runId: "987654321",
  runAttempt: 1,
  workflowRef: "c2melendez/precision-lab-lite/.github/workflows/bridge-command-runner.yml@refs/heads/main",
};
const lease = "00000000-0000-4000-8000-000000000002";
const manifest = {
  command_id: commandId,
  command_type: "repo.patch",
  target_repo: "lite",
  repository_full_name: "c2melendez/precision-lab-lite",
  expected_branch: "qa/syntax-audit-in625-a1",
  expected_sha: "b".repeat(40),
  request_fingerprint: "a".repeat(64),
  payload: { operations: [{ action: "create", path: "src/new.txt", content: "ok" }] },
  correlation_id: "correlation-1",
  validation_id: "validation-1",
  actions_run_id: identity.runId,
  lease_expires_at: "2026-10-30T20:00:00.000Z",
};
const validResult = {
  lease_token: lease,
  status: "awaiting_review",
  error_code: null,
  result: {
    validation_profile: "unit",
    validation_conclusion: "success",
    summary: "Tests and patch passed",
    base_sha: "b".repeat(40),
    head_sha: "c".repeat(40),
    commit_sha: "c".repeat(40),
    pull_request_number: 123,
    pull_request_url: "https://github.com/c2melendez/precision-lab-lite/pull/123",
    runner_run_url: "https://github.com/c2melendez/precision-lab-lite/actions/runs/987654321",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === "bridge_command_claim_runner") {
      return { data: { action: "claimed", lease_token: lease, manifest }, error: null };
    }
    if (name === "bridge_command_finish_runner") {
      return { data: { action: "completed", record: {
        id: commandId, status: "awaiting_review", actions_run_id: identity.runId,
        commit_sha: "c".repeat(40), pull_request_number: 123,
        pull_request_url: validResult.result.pull_request_url,
      } }, error: null };
    }
    return { data: null, error: { message: "unexpected RPC" } };
  });
});

describe("M2 Runner claim and callback service", () => {
  it("claims only an authenticated workflow's own command and returns an opaque lease", async () => {
    const response = await claimRunnerCommand(commandId, identity);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      command_id: commandId,
      expected_branch: manifest.expected_branch,
      expected_sha: manifest.expected_sha,
      lease_token: lease,
      lease_replayed: false,
    });
    expect(mocks.args[0]).toMatchObject({
      name: "bridge_command_claim_runner",
      args: {
        p_command_id: commandId,
        p_runner_repository: identity.repository,
        p_run_id: identity.runId,
        p_run_attempt: identity.runAttempt,
      },
    });
  });

  it("does not query the database for a malformed command ID", async () => {
    const response = await claimRunnerCommand("../another-command", identity);
    expect(response).toEqual({ status: 404, body: { error: "COMMAND_NOT_FOUND" } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails closed if the stored manifest does not match the OIDC repository", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { action: "claimed", lease_token: lease, manifest: {
        ...manifest, repository_full_name: "c2melendez/precision-lab-plus",
      } },
      error: null,
    });
    const response = await claimRunnerCommand(commandId, identity);
    expect(response).toEqual({ status: 503, body: { error: "RUNNER_MANIFEST_INVALID" } });
  });

  it("validates callback fields and repository-scoped PR URLs before the RPC", async () => {
    const invalid = {
      ...validResult,
      result: {
        ...validResult.result,
        pull_request_url: "https://github.com/attacker/other/pull/123",
      },
    };
    const response = await finishRunnerCommand(commandId, identity, invalid);
    expect(response).toEqual({ status: 422, body: { error: "RUNNER_CALLBACK_SCHEMA_INVALID" } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects unknown callback fields rather than storing caller-controlled data", async () => {
    const response = await finishRunnerCommand(commandId, identity, {
      ...validResult,
      actor: "client-selected",
    });
    expect(response).toEqual({ status: 422, body: { error: "RUNNER_CALLBACK_SCHEMA_INVALID" } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("hashes the lease token and stores only allowlisted callback result fields", async () => {
    const response = await finishRunnerCommand(commandId, identity, validResult);
    expect(response).toMatchObject({
      status: 200,
      body: {
        command_id: commandId,
        status: "awaiting_review",
        actions_run_id: identity.runId,
        commit_sha: "c".repeat(40),
        pull_request_number: 123,
      },
    });
    expect(mocks.args[0].name).toBe("bridge_command_finish_runner");
    expect(mocks.args[0].args).toMatchObject({
      p_command_id: commandId,
      p_runner_repository: identity.repository,
      p_run_id: identity.runId,
      p_lease_token: lease,
      p_final_status: "awaiting_review",
    });
    expect(mocks.args[0].args["p_lease_token_hash"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("maps an expired or invalid database lease to a conflict without leaking details", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "BRIDGE_RUNNER_LEASE_INVALID: internal row details" },
    });
    const response = await finishRunnerCommand(commandId, identity, validResult);
    expect(response).toEqual({ status: 409, body: { error: "RUNNER_LEASE_INVALID" } });
    expect(JSON.stringify(response)).not.toContain("internal row details");
  });
});
