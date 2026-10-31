// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}));

import { commandExecutionEnabled, dispatchAcceptedCommand } from "./runner-dispatch.server";

const id = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  process.env["BRIDGE_COMMAND_EXECUTION_ENABLED"] = "true";
  process.env["GH_TOKEN"] = "server-side-test-token";
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === "bridge_command_begin_dispatch") {
      return { data: { action: "started", record: { status: "validating" } }, error: null };
    }
    return { data: { action: "recorded" }, error: null };
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env["BRIDGE_COMMAND_EXECUTION_ENABLED"];
  delete process.env["GH_TOKEN"];
});

describe("M2 Bridge command workflow dispatcher", () => {
  it("keeps execution disabled unless both the feature flag and server token are present", async () => {
    process.env["BRIDGE_COMMAND_EXECUTION_ENABLED"] = "true";
    delete process.env["GH_TOKEN"];
    expect(commandExecutionEnabled()).toBe(false);
    await expect(dispatchAcceptedCommand(id, "lite")).resolves.toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();

    process.env["GH_TOKEN"] = "server-side-test-token";
    process.env["BRIDGE_COMMAND_EXECUTION_ENABLED"] = "false";
    expect(commandExecutionEnabled()).toBe(false);
    await expect(dispatchAcceptedCommand(id, "lite")).resolves.toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not dispatch again when a durable dispatch intent already exists", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { action: "replay", record: { status: "validating" } },
      error: null,
    });
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const result = await dispatchAcceptedCommand(id, "lite");
    expect(result).toMatchObject({
      outcome: "reconcile_required",
      errorCode: "DISPATCH_INTENT_ALREADY_EXISTS_RECONCILE_BEFORE_RETRY",
      recorded: true,
      commandStatus: "validating",
    });
    expect(request).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("bridge_command_begin_dispatch", { p_command_id: id });
  });

  it("dispatches only the opaque command ID on the fixed default branch", async () => {
    const started = Date.now();
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({
        workflow_runs: [{
          id: 222333444,
          display_title: "Bridge command " + id,
          head_branch: "main",
          created_at: new Date(started).toISOString(),
          html_url: "https://github.com/c2melendez/precision-lab-lite/actions/runs/222333444",
        }],
      }));
    vi.stubGlobal("fetch", request);

    const result = await dispatchAcceptedCommand(id, "lite");
    expect(result).toEqual({
      outcome: "queued",
      actionsRunId: "222333444",
      actionsRunUrl: "https://github.com/c2melendez/precision-lab-lite/actions/runs/222333444",
      errorCode: null,
      recorded: true,
      commandStatus: "queued",
    });
    expect(request).toHaveBeenCalledTimes(2);
    const lookupCall = request.mock.calls[1];
    expect(String(lookupCall[0])).toContain(
      "/repos/c2melendez/precision-lab-lite/actions/workflows/bridge-command-runner.yml/runs",
    );
    expect(String(lookupCall[0])).not.toContain("/repos/c2melendez/c2melendez/");
    const dispatchCall = request.mock.calls[0];
    expect(String(dispatchCall[0])).toContain(
      "/repos/c2melendez/precision-lab-lite/actions/workflows/bridge-command-runner.yml/dispatches",
    );
    expect(JSON.parse(String(dispatchCall[1]?.body))).toEqual({
      ref: "main",
      inputs: { command_id: id },
    });
    expect(mocks.rpc).toHaveBeenCalledWith("bridge_command_record_dispatch", expect.objectContaining({
      p_command_id: id,
      p_outcome: "queued",
      p_actions_run_id: "222333444",
    }));
  });

  it("turns definitive GitHub authorization rejection into a durable blocked outcome", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 403 })));
    const result = await dispatchAcceptedCommand(id, "plus");
    expect(result).toEqual({
      outcome: "blocked",
      actionsRunId: null,
      actionsRunUrl: null,
      errorCode: "GITHUB_DISPATCH_REJECTED_403",
      recorded: true,
      commandStatus: "blocked",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("bridge_command_record_dispatch", expect.objectContaining({
      p_outcome: "blocked",
      p_error_code: "GITHUB_DISPATCH_REJECTED_403",
    }));
  });

  it("does not pick an unrelated run when the run-name does not contain the command ID", async () => {
    const started = Date.now();
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({
        workflow_runs: [{
          id: 987,
          display_title: "Other workflow dispatch",
          head_branch: "main",
          created_at: new Date(started).toISOString(),
          html_url: "https://github.com/c2melendez/precision-lab-plus/actions/runs/987",
        }],
      }));
    vi.stubGlobal("fetch", request);
    const result = await dispatchAcceptedCommand(id, "plus");
    expect(result).toMatchObject({
      outcome: "reconcile_required",
      actionsRunId: null,
      recorded: true,
      commandStatus: "reconcile_required",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("bridge_command_record_dispatch", expect.objectContaining({
      p_outcome: "reconcile_required",
      p_error_code: "GITHUB_DISPATCH_RUN_NOT_FOUND",
    }));
  });

  it("records ambiguous 5xx dispatch outcomes for reconciliation and never retries the dispatch", async () => {
    const request = vi.fn(async () => new Response("temporary failure", { status: 500 }));
    vi.stubGlobal("fetch", request);
    const result = await dispatchAcceptedCommand(id, "lite");
    expect(result).toMatchObject({
      outcome: "reconcile_required",
      recorded: true,
      commandStatus: "reconcile_required",
    });
    expect(request.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
    expect(mocks.rpc).toHaveBeenCalledWith("bridge_command_record_dispatch", expect.objectContaining({
      p_outcome: "reconcile_required",
      p_error_code: "GITHUB_DISPATCH_OUTCOME_UNKNOWN",
    }));
  });
});
