export function toGroqTools(catalogueTools) {
  if (!Array.isArray(catalogueTools) || catalogueTools.length === 0) {
    throw new Error("INVALID_GROQ_TOOL_CATALOGUE");
  }

  return catalogueTools.map((tool) => {
    if (
      !tool ||
      tool.type !== "function" ||
      typeof tool.name !== "string" ||
      typeof tool.description !== "string" ||
      !tool.parameters ||
      typeof tool.parameters !== "object" ||
      tool.parameters.type !== "object"
    ) {
      throw new Error("INVALID_GROQ_TOOL_DEFINITION");
    }

    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    };
  });
}

export function nextGroqToolChoice(requiredTools, invokedTools) {
  const invoked = new Set(invokedTools);
  const next = requiredTools.find((name) => !invoked.has(name));
  return next
    ? { type: "function", function: { name: next } }
    : "none";
}

export function parseGroqAssistantMessage(response) {
  const message = response?.choices?.[0]?.message;
  if (!message || message.role !== "assistant") {
    throw new Error("GROQ_RESPONSE_MESSAGE_MISSING");
  }

  const toolCalls = message.tool_calls ?? [];
  if (!Array.isArray(toolCalls)) {
    throw new Error("GROQ_TOOL_CALLS_INVALID");
  }
  if (toolCalls.length > 1) {
    throw new Error("GROQ_PARALLEL_TOOL_CALLS_NOT_ALLOWED");
  }

  return {
    id: typeof response.id === "string" ? response.id : null,
    message,
    toolCalls,
    finalText: typeof message.content === "string" ? message.content : "",
  };
}
