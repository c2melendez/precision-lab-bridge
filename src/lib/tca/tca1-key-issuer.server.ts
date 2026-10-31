import type { CreateTca1KeyInput } from "./tca1-policy";
import { scopesForTca1AccessMode, tca1ExpiryIso } from "./tca1-policy";

export type Tca1StoredKey = {
  label: string;
  key_hash: string;
  key_prefix: string;
  scopes: string[];
  expires_at: string;
};

export type Tca1KeyIssuerDependencies = {
  newKey: () => string;
  hash: (value: string) => Promise<string>;
  insert: (record: Tca1StoredKey) => Promise<string>;
  nowMs?: () => number;
};

export type Tca1IssuedKey = {
  key: string;
  key_id: string;
  key_prefix: string;
  scopes: string[];
  expires_at: string;
};

/**
 * One-time issuance primitive. The database receives only the hash/prefix;
 * the raw key is returned to the authenticated admin UI once.
 */
export async function issueTca1Key(
  input: Omit<CreateTca1KeyInput, "password">,
  deps: Tca1KeyIssuerDependencies,
): Promise<Tca1IssuedKey> {
  const key = deps.newKey();
  const scopes = scopesForTca1AccessMode(input.accessMode);
  const expires_at = tca1ExpiryIso(input.ttlMinutes, deps.nowMs?.() ?? Date.now());
  const key_prefix = key.slice(0, 10);
  const key_hash = await deps.hash(key);
  if (!/^[a-f0-9]{64}$/i.test(key_hash)) throw new Error("TCA1_KEY_HASH_INVALID");

  let key_id: string;
  try {
    key_id = await deps.insert({
      label: input.label,
      key_hash,
      key_prefix,
      scopes,
      expires_at,
    });
  } catch {
    throw new Error("TCA1_KEY_CREATE_FAILED");
  }
  if (!key_id) throw new Error("TCA1_KEY_CREATE_FAILED");

  return { key, key_id, key_prefix, scopes, expires_at };
}
