import { describe, expect, it } from "vitest";
import {
  handleTca1FunctionGatewayRequest,
  type Tca1FunctionGatewayDependencies,
} from "./tca1-function-gateway.server";
import type { Tca1ToolAdapter } from "./tca1-tool-adapter.server";

const TOKEN = "tca1-gateway-concurrency-test-token-012345";
const BASE = "https://bridge.example.test/api/tca1/functions";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function request(value: string): Request {
  return new Request(BASE, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: "precision_lab_bridge_context_status",
      arguments: { repo: value },
    }),
  });
}

describe("TCA-1 Function Calling gateway concurrency", () => {
  it("runs independent handlers at the same time and isolates their responses", async () => {
    const started = deferred();
    const release = new Map([
      ["lite", deferred()],
      ["plus", deferred()],
    ]);
    const seen = new Set<string>();
    let peakActive = 0;
    let active = 0;

    const handler = async (input: unknown) => {
      const repo = (input as { repo: string }).repo;
      active += 1;
      peakActive = Math.max(peakActive, active);
      seen.add(repo);
      if (seen.size === 2) started.resolve();
      await release.get(repo)!.promise;
      active -= 1;
      return { repo, isolated: true };
    };

    const adapter: Tca1ToolAdapter = {
      accessMode: "read",
      tools: [{
        name: "precision_lab_bridge_context_status",
        description: "Concurrency fixture",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      }],
      handlers: { precision_lab_bridge_context_status: handler },
    };
    const dependencies: Tca1FunctionGatewayDependencies = {
      env: { TCA1_FUNCTION_GATEWAY_TOKEN: TOKEN },
      createAdapter: () => adapter,
    };

    const litePending = handleTca1FunctionGatewayRequest(request("lite"), dependencies);
    const plusPending = handleTca1FunctionGatewayRequest(request("plus"), dependencies);

    await started.promise;
    expect(peakActive).toBe(2);
    release.get("plus")!.resolve();
    const plusResponse = await plusPending;
    release.get("lite")!.resolve();
    const liteResponse = await litePending;

    expect(plusResponse.status).toBe(200);
    expect(liteResponse.status).toBe(200);
    expect(await plusResponse.json()).toEqual({ ok: true, result: { repo: "plus", isolated: true } });
    expect(await liteResponse.json()).toEqual({ ok: true, result: { repo: "lite", isolated: true } });
    expect(active).toBe(0);
  });
});
