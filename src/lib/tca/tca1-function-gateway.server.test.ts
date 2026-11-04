import { describe, expect, it, vi } from "vitest";
import { Tca1BridgeError } from "./bridge-client.server";
import {
  handleTca1FunctionGatewayRequest,
  type Tca1FunctionGatewayDependencies,
} from "./tca1-function-gateway.server";
import type { Tca1ToolAdapter } from "./tca1-tool-adapter.server";

const TOKEN = "tca1-gateway-test-token-0123456789abcdef";
const BASE = "https://bridge.example.test/api/tca1/functions";

function createAdapter(
  handlers: Tca1ToolAdapter["handlers"] = {
    precision_lab_bridge_capabilities: async () => ({ scopes: ["context:read"] }),
  },
): Tca1ToolAdapter {
  const tools = Object.keys(handlers).map((name) => ({
    name,
    description: "Read-only test tool",
    inputSchema: { type: "object" as const, properties: {}, additionalProperties: false as const },
  }));
  return { accessMode: "read", tools, handlers };
}

function dependencies(
  adapter: Tca1ToolAdapter = createAdapter(),
): Tca1FunctionGatewayDependencies {
  return {
    env: { TCA1_FUNCTION_GATEWAY_TOKEN: TOKEN },
    createAdapter: () => adapter,
  };
}

function request(
  method: "GET" | "POST",
  options: { token?: string; body?: string; contentType?: string; url?: string } = {},
): Request {
  const headers = new Headers();
  if (options.token !== undefined) headers.set("authorization", `Bearer ${options.token}`);
  if (options.contentType) headers.set("content-type", options.contentType);
  return new Request(options.url ?? BASE, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: options.body }),
  });
}

describe("TCA-1 Function Calling gateway", () => {
  it("rejects unauthenticated requests before initializing the adapter", async () => {
    const factory = vi.fn(() => createAdapter());
    const response = await handleTca1FunctionGatewayRequest(request("GET"), {
      ...dependencies(),
      createAdapter: factory,
    });
    expect(response.status).toBe(401);
    expect(factory).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });
  });

  it("returns only the configured tool catalogue and never returns credentials", async () => {
    const response = await handleTca1FunctionGatewayRequest(
      request("GET", { token: TOKEN }),
      dependencies(),
    );
    const result = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(result["access_mode"]).toBe("read");
    expect(result["tools"]).toEqual([{
      type: "function",
      name: "precision_lab_bridge_capabilities",
      description: "Read-only test tool",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    }]);
    expect(JSON.stringify(result)).not.toContain("TCA1_BRIDGE_KEY");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("dispatches only an exposed function name to its server-side handler", async () => {
    const handler = vi.fn(async (input: unknown) => ({ received: input }));
    const adapter = createAdapter({ precision_lab_bridge_context_status: handler });
    const response = await handleTca1FunctionGatewayRequest(
      request("POST", {
        token: TOKEN,
        contentType: "application/json",
        body: JSON.stringify({
          name: "precision_lab_bridge_context_status",
          arguments: { repo: "both" },
        }),
      }),
      dependencies(adapter),
    );
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith({ repo: "both" });
    expect(await response.json()).toEqual({
      ok: true,
      result: { received: { repo: "both" } },
    });
  });

  it("rejects function names that are not exposed in the selected access profile", async () => {
    const response = await handleTca1FunctionGatewayRequest(
      request("POST", {
        token: TOKEN,
        contentType: "application/json",
        body: JSON.stringify({
          name: "precision_lab_bridge_submit_command",
          arguments: {},
        }),
      }),
      dependencies(),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "TOOL_NOT_AVAILABLE" });
  });

  it("rejects malformed envelopes and non-JSON bodies", async () => {
    const noJson = await handleTca1FunctionGatewayRequest(
      request("POST", { token: TOKEN, body: "{}", contentType: "text/plain" }),
      dependencies(),
    );
    const malformed = await handleTca1FunctionGatewayRequest(
      request("POST", { token: TOKEN, body: "{", contentType: "application/json" }),
      dependencies(),
    );
    expect(noJson.status).toBe(415);
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "INVALID_JSON" });
  });

  it("rejects oversized requests and query-string transport", async () => {
    const oversized = await handleTca1FunctionGatewayRequest(
      new Request(BASE, {
        method: "POST",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
          "content-length": "70000",
        },
        body: "{}",
      }),
      dependencies(),
    );
    const query = await handleTca1FunctionGatewayRequest(
      request("GET", { token: TOKEN, url: `${BASE}?token=not-allowed` }),
      dependencies(),
    );
    expect(oversized.status).toBe(413);
    expect(query.status).toBe(400);
  });

  it("maps upstream Bridge failures to safe tool errors", async () => {
    const adapter = createAdapter({
      precision_lab_bridge_capabilities: async () => {
        throw new Tca1BridgeError(401, "BRIDGE_AUTH_FAILED");
      },
    });
    const response = await handleTca1FunctionGatewayRequest(
      request("POST", {
        token: TOKEN,
        contentType: "application/json",
        body: JSON.stringify({
          name: "precision_lab_bridge_capabilities",
          arguments: {},
        }),
      }),
      dependencies(adapter),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: false, error: "BRIDGE_AUTH_FAILED" });
  });

  it("fails closed when the gateway credential is missing or too short", async () => {
    const missing = await handleTca1FunctionGatewayRequest(request("GET"), { env: {} });
    const short = await handleTca1FunctionGatewayRequest(request("GET"), {
      env: { TCA1_FUNCTION_GATEWAY_TOKEN: "too-short" },
    });
    expect(missing.status).toBe(503);
    expect(short.status).toBe(503);
  });
});
