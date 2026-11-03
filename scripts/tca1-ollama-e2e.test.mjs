import { describe, expect, it, vi } from "vitest";
import {
  buildOllamaTools,
  runOllamaProbe,
  validateGatewayUrl,
  validateOllamaBaseUrl,
} from "./tca1-ollama-e2e.mjs";

const TOKEN = "a-test-gateway-token-that-is-long-enough-123456";
const GATEWAY = "https://precision-lab-bridge.onrender.com/api/tca1/functions";
const CATALOGUE = {
  access_mode: "read",
  tools: [
    { type: "function", name: "precision_lab_bridge_capabilities", description: "Read capability metadata", parameters: { type: "object", properties: {}, additionalProperties: false } },
    { type: "function", name: "precision_lab_bridge_context_status", description: "Read both repository states", parameters: { type: "object", properties: { repo: { type: "string", enum: ["lite", "plus", "both"] } }, additionalProperties: false } },
    { type: "function", name: "precision_lab_bridge_gate_plan", description: "Read gate plan", parameters: { type: "object", properties: { gate: { type: "string" }, repo: { type: "string" } }, additionalProperties: false } },
  ],
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("TCA-1 local Ollama harness", () => {
  it("restricts Ollama to loopback and validates the exact HTTPS gateway route", () => {
    expect(validateOllamaBaseUrl("http://127.0.0.1:11434/")).toBe("http://127.0.0.1:11434");
    expect(() => validateOllamaBaseUrl("https://ollama.example.test/")).toThrow("UNSAFE_OLLAMA_BASE_URL_LOCALHOST_ONLY");
    expect(() => validateGatewayUrl("https://precision-lab-bridge.onrender.com/api/tca1/functions?key=x")).toThrow("UNSAFE_TCA1_FUNCTION_GATEWAY_URL");
    expect(() => validateGatewayUrl("https://attacker.example/api/tca1/functions")).toThrow("UNSAFE_TCA1_FUNCTION_GATEWAY_URL");
    expect(validateGatewayUrl(GATEWAY).hostname).toBe("precision-lab-bridge.onrender.com");
    expect(validateGatewayUrl(GATEWAY).pathname).toBe("/api/tca1/functions");
  });

  it("requires both mandatory read-only tools in the catalogue", () => {
    expect(() => buildOllamaTools({ ...CATALOGUE, tools: [CATALOGUE.tools[0]] }))
      .toThrow("REQUIRED_READ_TOOL_MISSING:precision_lab_bridge_context_status");
  });

  it("rejects any write tool in a supposedly read-only catalogue", () => {
    expect(() => buildOllamaTools({ ...CATALOGUE, tools: [...CATALOGUE.tools, {
      type: "function", name: "precision_lab_bridge_submit_command", description: "write", parameters: { type: "object", properties: {} },
    }] })).toThrow("UNAPPROVED_OR_INVALID_TOOL_IN_READ_ONLY_CATALOGUE");
  });

  it("reports a sanitized upstream error code when a read tool fails", async () => {
    let modelTurn = 0;
    let gatewayPost = 0;
    const fetchImpl = vi.fn(async (input, init = {}) => {
      const url = String(input);
      if (url === GATEWAY && init.method === "GET") return jsonResponse(CATALOGUE);
      if (url === GATEWAY && init.method === "POST") {
        gatewayPost += 1;
        if (gatewayPost === 1) return jsonResponse({ ok: true, result: { capabilities: true } });
        return jsonResponse({ ok: false, error: "OBSERVER_UPSTREAM_ERROR" });
      }
      if (url === "http://127.0.0.1:11434/api/chat") {
        modelTurn += 1;
        if (modelTurn === 1) return jsonResponse({ message: { role: "assistant", content: "", tool_calls: [{ function: { name: "precision_lab_bridge_capabilities", arguments: {} } }] } });
        return jsonResponse({ message: { role: "assistant", content: "", tool_calls: [{ function: { name: "precision_lab_bridge_context_status", arguments: { repo: "both" } }] } });
      }
      throw new Error("unexpected mocked request");
    });

    await expect(runOllamaProbe({
      env: {
        OLLAMA_MODEL: "qwen3",
        OLLAMA_BASE_URL: "http://127.0.0.1:11434/",
        TCA1_FUNCTION_GATEWAY_TOKEN: TOKEN,
        TCA1_FUNCTION_GATEWAY_URL: GATEWAY,
      },
      fetchImpl,
    })).rejects.toThrow("TCA1_TOOL_CALL_RETURNED_ERROR:OBSERVER_UPSTREAM_ERROR");
    expect(gatewayPost).toBe(2);
  });

  it("completes both required read-only calls and keeps gateway credentials out of Ollama requests", async () => {
    const calls = [];
    let modelTurn = 0;
    const fetchImpl = vi.fn(async (input, init = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === GATEWAY && init.method === "GET") return jsonResponse(CATALOGUE);
      if (url === GATEWAY && init.method === "POST") {
        const envelope = JSON.parse(init.body);
        return jsonResponse({ ok: true, result: { tool: envelope.name, repo: envelope.arguments.repo ?? "n/a" } });
      }
      if (url === "http://127.0.0.1:11434/api/chat") {
        modelTurn += 1;
        const body = JSON.parse(init.body);
        expect(body.stream).toBe(false);
        expect(JSON.stringify(body)).not.toContain(TOKEN);
        if (modelTurn === 1) return jsonResponse({ message: { role: "assistant", content: "", tool_calls: [{ function: { name: "precision_lab_bridge_capabilities", arguments: {} } }] } });
        if (modelTurn === 2) return jsonResponse({ message: { role: "assistant", content: "", tool_calls: [{ function: { name: "precision_lab_bridge_context_status", arguments: { repo: "both" } } }] } });
        return jsonResponse({ message: { role: "assistant", content: "Read-only checks completed." } });
      }
      throw new Error("unexpected mocked request");
    });

    const result = await runOllamaProbe({
      env: {
        OLLAMA_MODEL: "qwen3",
        OLLAMA_BASE_URL: "http://127.0.0.1:11434/",
        TCA1_FUNCTION_GATEWAY_TOKEN: TOKEN,
        TCA1_FUNCTION_GATEWAY_URL: GATEWAY,
      },
      fetchImpl,
    });
    expect(result.verified).toBe(true);
    expect(result.tool_calls.map((item) => item.name)).toEqual([
      "precision_lab_bridge_capabilities",
      "precision_lab_bridge_context_status",
    ]);
    const modelRequests = calls.filter((call) => call.url.includes("/api/chat"));
    expect(modelRequests).toHaveLength(3);
    expect(modelRequests.every((call) => !new Headers(call.init.headers).has("authorization"))).toBe(true);
    const gatewayPosts = calls.filter((call) => call.url === GATEWAY && call.init.method === "POST");
    expect(gatewayPosts).toHaveLength(2);
    expect(gatewayPosts.every((call) => new Headers(call.init.headers).get("authorization") === `Bearer ${TOKEN}`)).toBe(true);
  });
});
