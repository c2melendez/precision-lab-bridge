// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildComparison } from "./compare.mjs";

function campaign(provider, model) {
  return {
    benchmark_version: "2.1.0",
    prompt_version: "cb-prompt-v1",
    fixture_sha256: "a".repeat(64),
    source_sha: "b".repeat(40),
    requested_repetitions: 3,
    minimum_repetitions: 3,
    model_provider: provider,
    model_id: model,
    model_version: "test-fingerprint",
    transport: provider === "ollama" ? "ollama-local-api" : "groq-cloud-chat-completions",
    campaign_id: provider + "-campaign",
    stop_reason: null,
    summary: {
      by_status: { PASS: 3, PASS_PARTIAL: 0, FAIL: 0, BLOCKED: 0, CRITICAL: 0 },
      by_test: {
        CB1: { repetitions_recorded: 3, mean_score: provider === "ollama" ? 3 : 4, median_score: 3, standard_deviation: 0 },
        CB2: { repetitions_recorded: 3, mean_score: 2, median_score: 2, standard_deviation: 0 },
      },
      dimension_averages_0_to_4: { exactness: 3, reliability_security: 4 },
    },
  };
}

describe("CB1-CB10 cross-provider campaign comparison", () => {
  it("compares only identical benchmark, prompt, fixture, source and repetition metadata", () => {
    const result = buildComparison(campaign("ollama", "qwen3:latest"), campaign("groq", "openai/gpt-oss-20b"));
    expect(result.tests).toHaveLength(2);
    expect(result.tests[0].groq_minus_ollama).toBe(1);
    expect(result.source_sha).toBe("b".repeat(40));
  });

  it("rejects a mismatch in full-fixture digest", () => {
    const groq = campaign("groq", "openai/gpt-oss-20b");
    groq.fixture_sha256 = "c".repeat(64);
    expect(() => buildComparison(campaign("ollama", "qwen3:latest"), groq))
      .toThrow("CAMPAIGNS_NOT_COMPARABLE:fixture_sha256");
  });

  it("rejects incomplete campaigns and mismatched source commits", () => {
    const groq = campaign("groq", "openai/gpt-oss-20b");
    groq.summary.by_status.BLOCKED = 1;
    expect(() => buildComparison(campaign("ollama", "qwen3:latest"), groq))
      .toThrow("BLOCKED_REPETITIONS:groq");
    groq.summary.by_status.BLOCKED = 0;
    groq.source_sha = "c".repeat(40);
    expect(() => buildComparison(campaign("ollama", "qwen3:latest"), groq))
      .toThrow("CAMPAIGNS_NOT_COMPARABLE:source_sha");
  });
});
