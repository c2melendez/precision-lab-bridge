import { describe, expect, it } from "vitest";
import {
  nextGroqToolChoice,
  parseGroqAssistantMessage,
  toGroqInitialMessages,
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
    expect(converted[0].function).not.toHaveProperty("strict");
  });

  it("places GPT-OSS instructions and request in one user message", () => {
    const messages = toGroqInitialMessages([
      { role: "system", content: "Never submit or dispatch commands." },
      { role: "user", content: "Read capabilities and status." },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toContain("Never submit or dispatch commands.");
    expect(messages[0].content).toContain("Read capabilities and status.");
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

  it("rejects malformed tool definitions or initial messages", () => {
    expect(() => toGroqTools([{ type: "function", name: "bad" }])).toThrow("INVALID_GROQ_TOOL_DEFINITION");
    expect(() => toGroqInitialMessages([{ role: "user", content: "Hi" }])).toThrow("INVALID_GROQ_INITIAL_MESSAGES");
  });
});
