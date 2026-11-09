// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { issueTca1Key, type Tca1StoredKey } from "./tca1-key-issuer.server";

const RAW_KEY = "plb_tca1_one_time_credential_value";
const HASH = "a".repeat(64);
const INPUT = {
  label: "tca1-consumer-a",
  ttlMinutes: 15,
  accessMode: "read" as const,
};

describe("TCA-1A one-time key issuer", () => {
  it("stores only hash/prefix and returns the raw key once with read-only scope", async () => {
    const stored: Tca1StoredKey[] = [];
    const hash = vi.fn(async (value: string) => {
      expect(value).toBe(RAW_KEY);
      return HASH;
    });
    const result = await issueTca1Key(INPUT, {
      newKey: () => RAW_KEY,
      hash,
      nowMs: () => Date.parse("2026-10-31T12:00:00.000Z"),
      insert: async (row) => {
        stored.push(row);
        return "key-id-1";
      },
    });

    expect(result).toEqual({
      key: RAW_KEY,
      key_id: "key-id-1",
      key_prefix: RAW_KEY.slice(0, 10),
      scopes: ["context:read"],
      expires_at: "2026-10-31T12:15:00.000Z",
    });
    expect(stored).toEqual([{
      label: INPUT.label,
      key_hash: HASH,
      key_prefix: RAW_KEY.slice(0, 10),
      scopes: ["context:read"],
      expires_at: "2026-10-31T12:15:00.000Z",
    }]);
    expect(JSON.stringify(stored)).not.toContain(RAW_KEY);
    expect(Object.keys(stored[0] ?? {})).not.toContain("key");
    expect(hash).toHaveBeenCalledTimes(1);
  });

  it("issues submit profile with exactly command scopes and bounded expiry", async () => {
    let stored: Tca1StoredKey | undefined;
    const result = await issueTca1Key({
      ...INPUT,
      accessMode: "submit",
      ttlMinutes: 1440,
    }, {
      newKey: () => RAW_KEY,
      hash: async () => HASH,
      nowMs: () => Date.parse("2026-10-31T00:00:00.000Z"),
      insert: async (row) => {
        stored = row;
        return "key-id-2";
      },
    });
    expect(result.scopes).toEqual(["context:read", "command:submit", "command:read"]);
    expect(stored?.scopes).toEqual(result.scopes);
    expect(result.expires_at).toBe("2026-11-01T00:00:00.000Z");
  });

  it("fails closed when persistence fails without revealing the key or storage error", async () => {
    await expect(issueTca1Key(INPUT, {
      newKey: () => RAW_KEY,
      hash: async () => HASH,
      insert: async () => { throw new Error(`db error ${RAW_KEY}`); },
    })).rejects.toThrow("TCA1_KEY_CREATE_FAILED");
  });

  it("rejects an invalid key hash and never persists it", async () => {
    const insert = vi.fn(async () => "key-id");
    await expect(issueTca1Key(INPUT, {
      newKey: () => RAW_KEY,
      hash: async () => "not-a-sha256",
      insert,
    })).rejects.toThrow("TCA1_KEY_HASH_INVALID");
    expect(insert).not.toHaveBeenCalled();
  });
});
