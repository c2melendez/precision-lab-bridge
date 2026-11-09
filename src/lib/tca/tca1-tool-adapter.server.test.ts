// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  createTca1ToolAdapter,
  type Tca1ToolAdapter,
} from "./tca1-tool-adapter.server";
import type { Tca1BridgeClient } from "./bridge-client.server";

function fakeClient(): Tca1BridgeClient {
  return {
    getCapabilities: vi.fn(async () => ({ supported_commands: ["repo.inspect"] })),
    getContextStatus: vi.fn(async () => ({ repositories: [] })),
    getGatePlan: vi.fn(async () => ({ decision: "WAIT" })),
    submitCommand: vi.fn(async () => ({ command_id: "00000000-0000-4000-8000-000000000001" })),
    getCommand: vi.fn(async () => ({ status: "accepted" })),
    lookupCommand: vi.fn(async () => ({ status: "accepted" })),
  };
}

describe("TCA-1 host tool adapter", () => {
  it("exposes only read tools in read mode", () => {
    const adapter = createTca1ToolAdapter(fakeClient(), "read");
    expect(adapter.tools.map((tool) => tool.name)).toEqual([
      "precision_lab_bridge_capabilities",
      "precision_lab_bridge_context_status",
      "precision_lab_bridge_gate_plan",
    ]);
    expect(Object.keys(adapter.handlers)).toEqual(adapter.tools.map((tool) => tool.name));
  });

  it("exposes submit and receipt tools only in submit mode", () => {
    const adapter = createTca1ToolAdapter(fakeClient(), "submit");
    expect(adapter.tools).toHaveLength(6);
    expect(adapter.tools.map((tool) => tool.name)).toContain("precision_lab_bridge_submit_command");
    expect(adapter.tools.map((tool) => tool.name)).toContain("precision_lab_bridge_lookup_command");
  });

  it("never includes credential fields in tool definitions or arguments", () => {
    const adapter = createTca1ToolAdapter(fakeClient(), "submit");
    const serialized = JSON.stringify(adapter.tools).toLowerCase();
    expect(serialized).not.toContain("bridge_key");
    expect(serialized).not.toContain("api_key");
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain("password");
  });

  it("validates tool input before invoking the Bridge client", async () => {
    const client = fakeClient();
    const adapter: Tca1ToolAdapter = createTca1ToolAdapter(client, "read");
    await expect(adapter.handlers["precision_lab_bridge_gate_plan"]!({
      gate: "../secret",
      repo: "lite",
    })).rejects.toThrow();
    expect(client.getGatePlan).not.toHaveBeenCalled();
  });

  it("does not expose submit handlers under a read-only profile", () => {
    const adapter = createTca1ToolAdapter(fakeClient(), "read");
    expect(adapter.handlers["precision_lab_bridge_submit_command"]).toBeUndefined();
  });
});
