// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  createTca1KeyInputSchema,
  parseTca1BridgeBaseUrl,
  resolveTca1RuntimeConfig,
  scopesForTca1AccessMode,
  tca1ExpiryIso,
} from "./tca1-policy";

describe("TCA-1 key issuance policy", () => {
  it("creates read-only scopes by default policy", () => {
    expect(scopesForTca1AccessMode("read")).toEqual(["context:read"]);
  });

  it("requires all three command scopes for submit mode", () => {
    expect(scopesForTca1AccessMode("submit")).toEqual([
      "context:read", "command:submit", "command:read",
    ]);
  });

  it("accepts a bounded temporary key request", () => {
    expect(createTca1KeyInputSchema.safeParse({
      password: "admin-password",
      label: "tca1-consumer-a",
      ttlMinutes: 60,
      accessMode: "read",
    }).success).toBe(true);
  });

  it.each([0, 4, 1441, 1.5, Number.NaN])("rejects unsafe TTL %s", (ttlMinutes) => {
    expect(createTca1KeyInputSchema.safeParse({
      password: "admin-password",
      label: "tca1-consumer-a",
      ttlMinutes,
      accessMode: "read",
    }).success).toBe(false);
  });

  it("rejects labels not namespaced for TCA-1", () => {
    expect(createTca1KeyInputSchema.safeParse({
      password: "admin-password",
      label: "ordinary-key",
      ttlMinutes: 60,
      accessMode: "read",
    }).success).toBe(false);
  });

  it("rejects legacy scopes and unexpected properties", () => {
    expect(createTca1KeyInputSchema.safeParse({
      password: "admin-password",
      label: "tca1-consumer-a",
      ttlMinutes: 60,
      accessMode: "read",
      scopes: ["read", "dispatch"],
    }).success).toBe(false);
  });

  it("calculates expiration using minutes", () => {
    expect(tca1ExpiryIso(15, Date.parse("2026-10-31T12:00:00.000Z")))
      .toBe("2026-10-31T12:15:00.000Z");
  });
});

describe("TCA-1 runtime configuration", () => {
  it("accepts HTTPS Bridge origins and local HTTP for development", () => {
    expect(parseTca1BridgeBaseUrl("https://bridge.example/")).toBe("https://bridge.example");
    expect(parseTca1BridgeBaseUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it.each([
    "http://bridge.example",
    "https://user:password@bridge.example",
    "https://bridge.example/?key=secret",
    "https://bridge.example/#token",
    "https://bridge.example/untrusted-prefix",
  ])("rejects unsafe Bridge base URL %s", (value) => {
    expect(() => parseTca1BridgeBaseUrl(value)).toThrow();
  });

  it("loads the credential without returning it through tool parameters", () => {
    const config = resolveTca1RuntimeConfig({
      TCA1_BRIDGE_BASE_URL: "https://bridge.example",
      TCA1_BRIDGE_KEY: "plb_test_credential_value",
      TCA1_ACCESS_MODE: "read",
    });
    expect(config.baseUrl).toBe("https://bridge.example");
    expect(config.accessMode).toBe("read");
    expect(config.timeoutMs).toBe(10_000);
    expect(JSON.stringify({ baseUrl: config.baseUrl, accessMode: config.accessMode }))
      .not.toContain("plb_test_credential_value");
  });

  it("fails closed when credentials are missing or access mode is invalid", () => {
    expect(() => resolveTca1RuntimeConfig({ TCA1_BRIDGE_BASE_URL: "https://bridge.example" }))
      .toThrow("TCA1_BRIDGE_KEY_MISSING_OR_INVALID");
    expect(() => resolveTca1RuntimeConfig({
      TCA1_BRIDGE_BASE_URL: "https://bridge.example",
      TCA1_BRIDGE_KEY: "plb_test_credential_value",
      TCA1_ACCESS_MODE: "admin",
    })).toThrow("TCA1_ACCESS_MODE_INVALID");
  });
});
