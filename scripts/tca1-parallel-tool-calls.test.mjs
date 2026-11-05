import { describe, expect, it } from "vitest";
import { executeParallelTca1FunctionCalls } from "./tca1-parallel-tool-calls.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

describe("TCA-1 parallel Function Calling orchestration", () => {
  it("fans out calls concurrently and preserves call_id correlation when completion is out of order", async () => {
    const startedA = deferred();
    const startedB = deferred();
    const releaseA = deferred();
    const releaseB = deferred();
    const completedB = deferred();
    const calls = [
      { call_id: "call-alpha", name: "tool_alpha", arguments: JSON.stringify({ value: "A" }) },
      { call_id: "call-beta", name: "tool_beta", arguments: JSON.stringify({ value: "B" }) },
    ];

    const pending = executeParallelTca1FunctionCalls(calls, async (call, args) => {
      if (call.call_id === "call-alpha") {
        startedA.resolve();
        await releaseA.promise;
        return { ok: true, result: { value: args.value } };
      }
      startedB.resolve();
      await releaseB.promise;
      completedB.resolve();
      return { ok: true, result: { value: args.value } };
    });

    await Promise.all([startedA.promise, startedB.promise]);
    releaseB.resolve();
    await completedB.promise;
    releaseA.resolve();

    const results = await pending;
    expect(results.map((item) => item.call_id)).toEqual(["call-alpha", "call-beta"]);
    expect(results.map((item) => JSON.parse(item.output).result.value)).toEqual(["A", "B"]);
    expect(results.every((item) => item.ok)).toBe(true);
  });

  it("retains successful sibling outputs when one call fails", async () => {
    const calls = [
      { call_id: "call-good", name: "tool_good", arguments: "{}" },
      { call_id: "call-bad", name: "tool_bad", arguments: "{}" },
    ];

    const results = await executeParallelTca1FunctionCalls(calls, async (call) => {
      if (call.call_id === "call-bad") throw new Error("sensitive upstream detail");
      return { ok: true, result: { retained: true } };
    });

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ call_id: "call-good", ok: true });
    expect(JSON.parse(results[0].output)).toEqual({ ok: true, result: { retained: true } });
    expect(results[1]).toMatchObject({ call_id: "call-bad", ok: false });
    expect(JSON.parse(results[1].output)).toEqual({ ok: false, error: "TCA1_TOOL_CALL_FAILED" });
    expect(results[1].output).not.toContain("sensitive upstream detail");
  });

  it("converts malformed arguments into a per-call failure without dropping other calls", async () => {
    const calls = [
      { call_id: "call-invalid", name: "tool_invalid", arguments: "{" },
      { call_id: "call-valid", name: "tool_valid", arguments: "{}" },
    ];
    const results = await executeParallelTca1FunctionCalls(calls, async () => ({ ok: true }));

    expect(results.map((item) => item.call_id)).toEqual(["call-invalid", "call-valid"]);
    expect(results[0].ok).toBe(false);
    expect(results[1].ok).toBe(true);
  });
});
