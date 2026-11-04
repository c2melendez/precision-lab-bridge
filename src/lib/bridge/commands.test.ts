import { describe, expect, it } from "vitest";
import { fingerprintCommand, parseCommandEnvelope, readBoundedCommandBody, stableStringify } from "./commands";

const sha = "a".repeat(40);
const valid = (overrides: Record<string, unknown> = {}) => ({
  schema_version: 1,
  command_type: "repo.inspect",
  target_repo: "lite",
  expected_branch: "qa/syntax-audit-in625-a1",
  expected_sha: sha,
  payload: {},
  idempotency_key: "test-command-1",
  correlation_id: "correlation-1",
  validation_id: "validation-1",
  ...overrides,
});

describe("bounded command request body reader", () => {
  it("rejects an oversized streamed body without buffering the full payload", async () => {
    const payload = new Uint8Array(256 * 1024 + 1);
    const request = new Request("https://bridge.example/api/v1/commands", {
      method: "POST",
      body: payload,
    });
    await expect(readBoundedCommandBody(request)).resolves.toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("rejects an oversized declared content length before reading", async () => {
    const request = new Request("https://bridge.example/api/v1/commands", {
      method: "POST",
      headers: { "content-length": String(256 * 1024 + 1) },
      body: "{}",
    });
    await expect(readBoundedCommandBody(request)).resolves.toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("rejects invalid UTF-8 instead of silently replacing bytes", async () => {
    const request = new Request("https://bridge.example/api/v1/commands", {
      method: "POST",
      body: new Uint8Array([0xff, 0xfe]),
    });
    await expect(readBoundedCommandBody(request)).resolves.toEqual({
      ok: false,
      reason: "invalid_utf8",
    });
  });
});

describe("M1 command envelope validation", () => {
  it("accepts a valid inspect request only when the idempotency header matches", () => {
    const result = parseCommandEnvelope(valid(), "test-command-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.expected_sha).toBe(sha);
      expect(result.envelope.command_type).toBe("repo.inspect");
    }
  });

  it("rejects a missing or mismatched idempotency header", () => {
    expect(parseCommandEnvelope(valid(), null)).toMatchObject({ ok: false, status: 400 });
    expect(parseCommandEnvelope(valid(), "different-key")).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects unknown envelope properties and command types", () => {
    expect(parseCommandEnvelope(valid({ actor: "client-controlled" }), "test-command-1"))
      .toMatchObject({ ok: false, status: 422 });
    expect(parseCommandEnvelope(valid({ command_type: "shell.exec" }), "test-command-1"))
      .toMatchObject({ ok: false, status: 400 });
  });

  it("rejects noncanonical SHA and unsafe branches", () => {
    expect(parseCommandEnvelope(valid({ expected_sha: "deadbeef" }), "test-command-1"))
      .toMatchObject({ ok: false, status: 400 });
    for (const expected_branch of ["../main", "main//evil", ".hidden", "branch.lock"]) {
      expect(parseCommandEnvelope(valid({ expected_branch }), "test-command-1"))
        .toMatchObject({ ok: false, status: 400 });
    }
  });

  it("requires an allowlisted validation profile", () => {
    expect(parseCommandEnvelope(valid({
      command_type: "repo.validate",
      payload: { profile: "unit" },
    }), "test-command-1").ok).toBe(true);
    expect(parseCommandEnvelope(valid({
      command_type: "repo.validate",
      payload: { profile: "arbitrary-shell" },
    }), "test-command-1")).toMatchObject({ ok: false, status: 422 });
  });

  it("rejects traversal, secret and workflow paths", () => {
    for (const path of ["../README.md", ".env", ".env.production", ".github/workflows/evil.yml",
      "secrets/token.txt", "src/../../escape.ts", "keys/private.pem"]) {
      const result = parseCommandEnvelope(valid({
        command_type: "repo.patch",
        payload: { operations: [{ action: "create", path, content: "no" }] },
      }), "test-command-1");
      expect(result).toMatchObject({ ok: false, status: 422 });
    }
  });

  it("rejects repeated paths and destructive operations without expected blob SHA", () => {
    const duplicate = parseCommandEnvelope(valid({
      command_type: "repo.patch",
      payload: { operations: [
        { action: "create", path: "src/a.ts", content: "a" },
        { action: "create", path: "src/a.ts", content: "b" },
      ] },
    }), "test-command-1");
    expect(duplicate).toMatchObject({ ok: false, status: 422 });

    const missingSha = parseCommandEnvelope(valid({
      command_type: "repo.patch",
      payload: { operations: [{ action: "delete", path: "src/a.ts" }] },
    }), "test-command-1");
    expect(missingSha).toMatchObject({ ok: false, status: 422 });
  });

  it("limits individual files and aggregate patch content", () => {
    const fileTooLarge = parseCommandEnvelope(valid({
      command_type: "repo.patch",
      payload: { operations: [{ action: "create", path: "src/big.ts", content: "x".repeat(65 * 1024) }] },
    }), "test-command-1");
    expect(fileTooLarge).toMatchObject({ ok: false, status: 422 });

    const patchTooLarge = parseCommandEnvelope(valid({
      command_type: "repo.patch",
      payload: { operations: Array.from({ length: 4 }, (_, i) => ({
        action: "create", path: "src/file-" + i + ".txt", content: "x".repeat(50 * 1024),
      })) },
    }), "test-command-1");
    expect(patchTooLarge).toMatchObject({ ok: false, status: 422 });

  });

  it("canonicalizes object key ordering for stable fingerprints", () => {
    expect(stableStringify({ z: 1, a: { y: 2, x: 3 } }))
      .toBe(stableStringify({ a: { x: 3, y: 2 }, z: 1 }));
  });
});
