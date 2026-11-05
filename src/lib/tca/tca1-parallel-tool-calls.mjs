/**
 * Execute one provider response's function calls concurrently.
 * Results preserve input order and call_id correlation. Failed calls become
 * safe per-call outputs so successful sibling results are never discarded.
 */
export async function executeParallelTca1FunctionCalls(functionCalls, invoke) {
  if (!Array.isArray(functionCalls) || typeof invoke !== "function") {
    throw new TypeError("INVALID_PARALLEL_FUNCTION_CALL_INPUT");
  }

  const settled = await Promise.allSettled(functionCalls.map(async (call) => {
    if (!call || typeof call.call_id !== "string" || !call.call_id ||
        typeof call.name !== "string" || typeof call.arguments !== "string") {
      throw new Error("INVALID_FUNCTION_CALL");
    }

    let args;
    try {
      args = JSON.parse(call.arguments);
    } catch {
      throw new Error("INVALID_FUNCTION_ARGUMENTS");
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw new Error("INVALID_FUNCTION_ARGUMENTS");
    }

    const result = await invoke(call, args);
    const output = JSON.stringify(result);
    if (typeof output !== "string") throw new Error("INVALID_TOOL_OUTPUT");
    return { call_id: call.call_id, ok: result?.ok === true, output };
  }));

  return settled.map((outcome, index) => {
    const callId = functionCalls[index]?.call_id;
    if (outcome.status === "fulfilled") return outcome.value;
    return {
      call_id: callId,
      ok: false,
      output: JSON.stringify({ ok: false, error: "TCA1_TOOL_CALL_FAILED" }),
    };
  });
}
