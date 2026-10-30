import { describe, expect, it } from "vitest";
import { fingerprintPayload, validateIdempotency, type IdempotentRequest } from "./idempotency";

const params = { target_repo: "lite", gate: "h1d", dry_run: true } as const;
const request: IdempotentRequest = { ...params, idempotency_key: "validation:1", validation_id: "v1",
  correlation_id: "c1", branch: "main", requested_sha: "a".repeat(40) };

describe("durable request identity", () => {
  it("requires a durable idempotency key before dispatch", () => {
    expect(validateIdempotency({}, params, "main").ok).toBe(false);
    expect(validateIdempotency({ idempotency_key: "validation:1" }, params, "main").ok).toBe(true);
  });
  it("fingerprints every dispatch and validation identity field", () => {
    for (const change of [{ target_repo: "plus" }, { gate: "security" }, { dry_run: false },
      { validation_id: "v2" }, { correlation_id: "c2" }, { branch: "release" }, { requested_sha: "b".repeat(40) }]) {
      expect(fingerprintPayload({ ...request, ...change } as IdempotentRequest)).not.toBe(fingerprintPayload(request));
    }
  });
  it("normalizes SHA and rejects abbreviated or unsafe metadata", () => {
    const parsed = validateIdempotency({ ...request, requested_sha: "A".repeat(40) }, params, "main");
    expect(parsed.ok && parsed.request.requested_sha).toBe("a".repeat(40));
    expect(validateIdempotency({ ...request, requested_sha: "abc123" }, params, "main").ok).toBe(false);
    expect(validateIdempotency({ ...request, correlation_id: "token\nsecret" }, params, "main").ok).toBe(false);
  });
});