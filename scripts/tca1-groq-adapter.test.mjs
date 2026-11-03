import { describe, expect, it } from "vitest";
import {
  nextGroqToolChoice,
  parseGroqAssistantMessage,
  toGroqTools,
} from "./tca1-groq-adapter.mjs";

describe("Groq Chat Completions adapter", () => {
  it("converts the read-only TCA1 catalogue to Chat Completions function tools", () => {
    const converted = toGroqTools([{
      type: "function",
      name: "precision_lab_bridge_context_status",
      description: "Read repository status.",
      parameters: {
        type: "object",
        properties: { repo: { type: "string", enum: ["lite", "plus", "both"] } },
        additionalProperties: false,
      },
    }]);

    expect(converted).toEqual([{
      type: "function",
      function: {
        name: "precision_lab_bridge_context_status",
        description: "Read repository status.",
        parameters: {
          type: "object",
          properties: { repo: { type: "string", enum: ["lite", "plus", "both"] } },
          additionalProperties: false,
        },
      },
    }]);
    expect(converted[0].function).not.toHaveProperty("strict", true);
  });

  it("forces required read tools one at a time and disables tools after completion", () => {
    expect(nextGroqToolChoice(["capabilities", "context"], [])).toEqual({
      type: "function",
      function: { name: "capabilities" },
    });
    expect(nextGroqToolChoice(["capabilities", "context"], ["capabilities"])).toEqual({
      type: "function",
      function: { name: "context" },
    });
    expect(nextGroqToolChoice(["capabilities", "context"], ["capabilities", "context"])).toBe("none");
  });

  it("normalizes one Groq function call without executing it", () => {
    const parsed = parseGroqAssistantMessage({
      id: "chatcmpl-test",
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "call-1",
            type: "function",
            function: {
              name: "precision_lab_bridge_capabilities",
              arguments: "{}",
            },
          }],
        },
      }],
    });

    expect(parsed.id).toBe("chatcmpl-test");
    expect(parsed.finalText).toBe("");
    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.toolCalls[0].function.name).toBe("precision_lab_bridge_capabilities");
  });

  it("rejects missing or parallel function calls", () => {
    expect(() => parseGroqAssistantMessage({ choices: [] })).toThrow("GROQ_RESPONSE_MESSAGE_MISSING");
    expect(() => parseGroqAssistantMessage({
      choices: [{ message: { role: "assistant", tool_calls: [{}, {}] } }],
    })).toThrow("GROQ_PARALLEL_TOOL_CALLS_NOT_ALLOWED");
  });

  it("rejects malformed tool definitions", () => {
    expect(() => toGroqTools([{ type: "function", name: "bad" }])).toThrow("INVALID_GROQ_TOOL_DEFINITION");
  });
});
