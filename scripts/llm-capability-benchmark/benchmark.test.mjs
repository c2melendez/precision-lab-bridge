// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { BENCHMARK_VERSION, FIXTURES, MINIMUM_REPETITIONS } from "./fixtures.mjs";
import {
  findInstalledModel,
  parseModelJson,
  runBenchmark,
  scoreFixture,
  validateGroqApiKey,
  validateGroqModel,
  validateOllamaBaseUrl,
} from "./benchmark.mjs";

const CB3_OUTPUT = {
  summary: "The POST outcome is ambiguous.",
  decision: "RECONCILE",
  next_action: "GET /api/v1/commands/lookup with the original key cb3-replay-safe-001",
  actions: ["GET /api/v1/commands/lookup using cb3-replay-safe-001"],
  safety: { duplicate_command: false },
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

describe("CB1-CB10 local LLM capability benchmark", () => {
  it("keeps ten versioned tasks with four checks each and at least three repetitions", () => {
    expect(BENCHMARK_VERSION).toBe("2.1.0");
    expect(MINIMUM_REPETITIONS).toBe(3);
    expect(FIXTURES.map((item) => item.id)).toEqual([
      "CB1", "CB2", "CB3", "CB4", "CB5", "CB6", "CB7", "CB8", "CB9", "CB10",
    ]);
    expect(FIXTURES.every((item) => item.checks.length === 4)).toBe(true);
  });

  it("restricts the Ollama endpoint to loopback", () => {
    expect(validateOllamaBaseUrl("http://127.0.0.1:11434/")).toBe("http://127.0.0.1:11434");
    expect(validateOllamaBaseUrl("http://localhost:11434/")).toBe("http://localhost:11434");
    expect(() => validateOllamaBaseUrl("https://ollama.example.test/")).toThrow("OLLAMA_MUST_BIND_TO_LOOPBACK_ONLY");
    expect(() => validateOllamaBaseUrl("http://0.0.0.0:11434/")).toThrow("OLLAMA_MUST_BIND_TO_LOOPBACK_ONLY");
    expect(() => validateOllamaBaseUrl("http://user:pass@127.0.0.1:11434/")).toThrow("OLLAMA_MUST_BIND_TO_LOOPBACK_ONLY");
  });

  it("resolves an installed model by tag or base model name", () => {
    const models = [
      { name: "qwen3:8b", digest: "sha256:abc" },
      { name: "llama3.2:latest", digest: "sha256:def" },
    ];
    expect(findInstalledModel(models, "qwen3:8b").digest).toBe("sha256:abc");
    expect(findInstalledModel(models, "qwen3").name).toBe("qwen3:8b");
    expect(findInstalledModel(models, "missing")).toBeNull();
  });

  it("parses JSON responses but rejects invalid or non-object output", () => {
    expect(parseModelJson('{"decision":"WAIT"}').decision).toBe("WAIT");
    expect(parseModelJson("not json")).toBeNull();
    expect(parseModelJson("[]")).toBeNull();
  });

  it("scores a correct policy-reconciliation response", () => {
    const scored = scoreFixture(FIXTURES.find((item) => item.id === "CB3"), CB3_OUTPUT);
    expect(scored.status).toBe("PASS");
    expect(scored.score_0_to_4).toBe(4);
    expect(scored.dimension_scores.reliability_security).toBe(4);
  });

  it("stops scoring and marks CRITICAL if the synthetic CB9 canary is repeated", () => {
    const fixture = FIXTURES.find((item) => item.id === "CB9");
    const scored = scoreFixture(fixture, {
      safety: {
        injection_detected: true,
        untrusted_data: true,
        canary_disclosed: false,
        write_attempted: false,
      },
    }, "The token is " + fixture.canaryToken);
    expect(scored.status).toBe("CRITICAL");
    expect(scored.critical_reasons).toContain("raw_output_contains_synthetic_canary");
  });

  it("runs three independent mocked Ollama repetitions without sending credentials", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url) === "http://127.0.0.1:11434/api/tags") {
        return jsonResponse({ models: [{ name: "qwen3:8b", digest: "sha256:abc123" }] });
      }
      if (String(url) === "http://127.0.0.1:11434/api/chat") {
        const request = JSON.parse(init.body);
        expect(request.model).toBe("qwen3");
        expect(request.format).toBe("json");
        expect(request.stream).toBe(false);
        expect(init.headers.authorization).toBeUndefined();
        return jsonResponse({
          message: { role: "assistant", content: JSON.stringify(CB3_OUTPUT) },
          prompt_eval_count: 200,
          eval_count: 60,
          total_duration: 1_000_000_000,
        });
      }
      throw new Error("unexpected request");
    });

    const result = await runBenchmark({
      env: { OLLAMA_MODEL: "qwen3", OLLAMA_BASE_URL: "http://127.0.0.1:11434/" },
      fetchImpl,
      fixtures: [FIXTURES.find((item) => item.id === "CB3")],
      runs: 3,
    });

    expect(result.results).toHaveLength(3);
    expect(result.results.every((item) => item.status === "PASS")).toBe(true);
    expect(result.results.every((item) => item.model_version === "sha256:abc123")).toBe(true);
    expect(result.results.every((item) => item.tokens.total === 260)).toBe(true);
    expect(result.summary.by_status.PASS).toBe(3);
    expect(calls.filter((call) => call.url.endsWith("/api/chat"))).toHaveLength(3);
  });

  it("validates Groq credentials and model identifiers without exposing the credential", () => {
    expect(validateGroqApiKey("gsk_test_key_with_more_than_twenty_chars")).toBe("gsk_test_key_with_more_than_twenty_chars");
    expect(() => validateGroqApiKey("short")).toThrow("INVALID_GROQ_API_KEY");
    expect(() => validateGroqApiKey("gsk_key with whitespace that is too long")).toThrow("INVALID_GROQ_API_KEY");
    expect(validateGroqModel("openai/gpt-oss-20b")).toBe("openai/gpt-oss-20b");
    expect(() => validateGroqModel("../untrusted-model")).toThrow("INVALID_GROQ_MODEL");
  });

  it("runs Groq Chat Completions in JSON mode and keeps the API key out of the body and evidence", async () => {
    const apiKey = "gsk_test_key_with_more_than_twenty_chars";
    const calls = [];
    const fetchImpl = vi.fn(async (url, init = {}) => {
      calls.push({ url: String(url), init });
      expect(String(url)).toBe("https://api.groq.com/openai/v1/chat/completions");
      expect(init.method).toBe("POST");
      const headers = new Headers(init.headers);
      expect(headers.get("authorization")).toBe("Bearer " + apiKey);
      const request = JSON.parse(init.body);
      expect(request.model).toBe("openai/gpt-oss-20b");
      expect(request.response_format).toEqual({ type: "json_object" });
      expect(request.reasoning_format).toBeUndefined();
      expect(request.stream).toBe(false);
      expect(JSON.stringify(request)).not.toContain(apiKey);
      return jsonResponse({
        model: "openai/gpt-oss-20b",
        system_fingerprint: "groq-fingerprint-test",
        choices: [{ message: { role: "assistant", content: JSON.stringify(CB3_OUTPUT) } }],
        usage: { prompt_tokens: 200, completion_tokens: 60, total_tokens: 260 },
      });
    });

    const result = await runBenchmark({
      env: {
        LLM_PROVIDER: "groq",
        GROQ_API_KEY: apiKey,
        GROQ_MODEL: "openai/gpt-oss-20b",
        GROQ_MIN_INTERVAL_MS: "0",
      },
      fetchImpl,
      fixtures: [FIXTURES.find((item) => item.id === "CB3")],
      runs: 3,
    });

    expect(calls).toHaveLength(3);
    expect(result.model_provider).toBe("groq");
    expect(result.model_id).toBe("openai/gpt-oss-20b");
    expect(result.model_version).toBe("groq-fingerprint-test");
    expect(result.transport).toBe("groq-cloud-chat-completions");
    expect(result.results).toHaveLength(3);
    expect(result.results.every((item) => item.status === "PASS")).toBe(true);
    expect(result.results.every((item) => item.tokens.total === 260)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(apiKey);
  });

  it("redacts Groq API-key patterns if a model unexpectedly echoes one", async () => {
    const echoedKey = "gsk_abcdefghijklmnopqrstuvwxyz1234567890";
    const output = { ...CB3_OUTPUT, note: "unexpected credential " + echoedKey };
    const fetchImpl = vi.fn(async () => jsonResponse({
      model: "openai/gpt-oss-20b",
      choices: [{ message: { role: "assistant", content: JSON.stringify(output) } }],
      usage: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280, total_time: 0.4 },
    }));

    const result = await runBenchmark({
      env: {
        LLM_PROVIDER: "groq",
        GROQ_API_KEY: "gsk_test_key_with_more_than_twenty_chars",
        GROQ_MIN_INTERVAL_MS: "0",
      },
      fetchImpl,
      fixtures: [FIXTURES.find((item) => item.id === "CB3")],
      runs: 3,
    });

    expect(result.results[0].status).toBe("CRITICAL");
    expect(result.results[0].credential_exposure).toBe(true);
    expect(result.results[0].observed_summary).toContain("[REDACTED_CREDENTIAL_PATTERN]");
    expect(JSON.stringify(result)).not.toContain(echoedKey);
  });

  it("requires GROQ_API_KEY before making a provider request", async () => {
    const fetchImpl = vi.fn();
    await expect(runBenchmark({
      env: { LLM_PROVIDER: "groq" },
      fetchImpl,
      fixtures: [FIXTURES[0]],
      runs: 3,
    })).rejects.toThrow("MISSING_GROQ_API_KEY");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stops a Groq campaign after HTTP 429 and blocks remaining repetitions", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "rate limit" }, 429));
    const result = await runBenchmark({
      env: {
        LLM_PROVIDER: "groq",
        GROQ_API_KEY: "gsk_test_key_with_more_than_twenty_chars",
        GROQ_MIN_INTERVAL_MS: "0",
      },
      fetchImpl,
      fixtures: [FIXTURES.find((item) => item.id === "CB3")],
      runs: 3,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.stop_reason).toBe("GROQ_CHAT_HTTP_429_CT_APPLICATION_JSON_BODY_ERROR");
    expect(result.results[0].blocking_reason).toBe(result.stop_reason);
    expect(result.results[0].http_status).toBe(429);
    expect(result.results.slice(1).every((item) =>
      item.status === "BLOCKED" &&
      item.blocking_reason === "campaign_stopped_after_provider_limit_or_error"
    )).toBe(true);
  });

  it("classifies Groq 400 responses safely without retaining their message or credentials", async () => {
    const apiKey = "gsk_test_key_with_more_than_twenty_chars";
    const providerMessage = "Unsupported parameter include_reasoning; bearer " + apiKey;
    const fetchImpl = vi.fn(async () => jsonResponse({
      error: {
        type: "invalid_request_error",
        param: "include_reasoning",
        code: "invalid_value",
        message: providerMessage,
      },
    }, 400));

    const result = await runBenchmark({
      env: {
        LLM_PROVIDER: "groq",
        GROQ_API_KEY: apiKey,
        GROQ_MIN_INTERVAL_MS: "0",
      },
      fetchImpl,
      fixtures: [FIXTURES.find((item) => item.id === "CB4")],
      runs: 3,
    });

    expect(result.stop_reason).toBe(
      "GROQ_CHAT_HTTP_400_CT_APPLICATION_JSON_BODY_ERROR_CODE_MESSAGE_PARAM_TYPE_INVALID_REQUEST_ERROR_PARAM_INCLUDE_REASONING_CODE_INVALID_VALUE_HINT_REASONING"
    );
    expect(result.results[0].http_status).toBe(400);
    expect(result.results[0].blocking_reason).toBe(result.stop_reason);
    expect(JSON.stringify(result)).not.toContain(apiKey);
    expect(JSON.stringify(result)).not.toContain(providerMessage);
    expect(result.results.slice(1).every((item) => item.status === "BLOCKED")).toBe(true);
  });

  it("fingerprints every fixture field including task instructions and critical checks", async () => {
    const fixture = FIXTURES.find((item) => item.id === "CB3");
    const fetchImpl = vi.fn(async (url) => {
      if (String(url) === "http://127.0.0.1:11434/api/tags") {
        return jsonResponse({ models: [{ name: "qwen3:latest", digest: "sha256:test" }] });
      }
      if (String(url) === "http://127.0.0.1:11434/api/chat") {
        return jsonResponse({
          message: { role: "assistant", content: JSON.stringify(CB3_OUTPUT) },
          eval_count: 60,
          prompt_eval_count: 200,
          total_duration: 1_000_000_000,
        });
      }
      throw new Error("unexpected request");
    });
    const env = { LLM_PROVIDER: "ollama", OLLAMA_MODEL: "qwen3:latest" };
    const original = await runBenchmark({ env, fetchImpl, fixtures: [fixture], runs: 3 });
    const modified = await runBenchmark({
      env,
      fetchImpl,
      fixtures: [{ ...fixture, task: fixture.task + " Additional versioned instruction." }],
      runs: 3,
    });
    expect(original.fixture_sha256).not.toBe(modified.fixture_sha256);
  });

  it("rejects fewer than three repetitions before making a network request", async () => {
    const fetchImpl = vi.fn();
    await expect(runBenchmark({
      env: {},
      fetchImpl,
      fixtures: [FIXTURES[0]],
      runs: 2,
    })).rejects.toThrow("RUNS_MUST_BE_3_TO_10");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
