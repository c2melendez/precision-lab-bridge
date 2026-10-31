// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const configured = Boolean(
  process.env["SUPABASE_URL"] &&
  (process.env["SUPABASE_SECRET_KEY"] || process.env["SUPABASE_SERVICE_ROLE_KEY"]),
);
const prefix = "m1-command-" + crypto.randomUUID();
const ids: string[] = [];
const nativeFetch = globalThis.fetch;
let ownerA = "";
let ownerB = "";
let legacyOwner = "";

async function createFixture(label: string, scopes: string[]) {
  const random = crypto.randomUUID();
  const { data, error } = await supabaseAdmin.from("bridge_keys").insert({
    label: prefix + ":" + label,
    key_hash: random.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
    key_prefix: "m1-test-" + label.slice(0, 2),
    scopes,
    expires_at: new Date(Date.now() + 600_000).toISOString(),
  }).select("id").single();
  if (error || !data) throw new Error("Could not create isolated M1 database fixture");
  ids.push(data.id);
  return data.id;
}

function args(keyId: string, idempotencyKey: string, fingerprint = "a".repeat(64)) {
  return {
    p_key_id: keyId,
    p_idempotency_key: idempotencyKey,
    p_command_type: "repo.inspect",
    p_target_repo: "lite",
    p_expected_branch: "qa/syntax-audit-in625-a1",
    p_expected_sha: "b".repeat(40),
    p_fingerprint: fingerprint,
    p_payload: {},
    p_observer_context: {
      repo: "lite",
      repository_full_name: "c2melendez/precision-lab-lite",
      canonical_branch: "qa/syntax-audit-in625-a1",
      current_head_sha: "b".repeat(40),
      state_status: "CURRENT",
      continuity_revision: 1,
      observed_at: new Date().toISOString(),
    },
    p_correlation_id: "correlation-" + idempotencyKey,
    p_validation_id: "validation-" + idempotencyKey,
  };
}

describe.skipIf(!configured)("M1 durable command database integration", () => {
  beforeAll(async () => {
    ownerA = await createFixture("owner-a", ["command:submit", "command:read", "context:read"]);
    ownerB = await createFixture("owner-b", ["command:submit", "command:read"]);
    legacyOwner = await createFixture("legacy", ["read", "dispatch"]);
  }, 30_000);

  afterAll(async () => {
    if (ids.length) {
      await supabaseAdmin.from("bridge_commands").delete().like("idempotency_key", prefix + "%");
      await supabaseAdmin.from("bridge_keys").delete().in("id", ids);
    }
  });

  it("serializes simultaneous same-owner submissions to one durable command", async () => {
    const key = prefix + ":concurrent";
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => supabaseAdmin.rpc("bridge_submit_command", args(ownerA, key))),
    );
    expect(responses.every((response) => response.error === null)).toBe(true);
    const actions = responses.map((response) => (response.data as { action: string }).action);
    expect(actions.filter((action) => action === "accepted")).toHaveLength(1);
    expect(actions.filter((action) => action === "replay")).toHaveLength(9);
    const records = responses.map((response) => (response.data as { record: { id: string } }).record.id);
    expect(new Set(records).size).toBe(1);
    const accepted = responses.find((response) => (response.data as { action: string }).action === "accepted")!.data as { record: { response: unknown } };
    expect(accepted.record.response).toMatchObject({ command_id: records[0], status: "accepted", replay_count: 0, execution_enabled: false });
    for (const response of responses) {
      expect((response.data as { record: { response: unknown } }).record.response).toEqual(accepted.record.response);
    }

    const { data, error } = await supabaseAdmin.from("bridge_commands")
      .select("id,replay_count,status")
      .eq("key_id", ownerA)
      .eq("idempotency_key", key)
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ id: records[0], replay_count: 9, status: "accepted" });
  });

  it("returns a conflict when the same owner reuses a key with a different fingerprint", async () => {
    const key = prefix + ":fingerprint";
    const first = await supabaseAdmin.rpc("bridge_submit_command", args(ownerA, key));
    expect(first.error).toBeNull();
    expect((first.data as { action: string }).action).toBe("accepted");
    const second = await supabaseAdmin.rpc("bridge_submit_command", args(ownerA, key, "c".repeat(64)));
    expect(second.error).toBeNull();
    expect(second.data).toEqual({ action: "conflict" });
  });

  it("isolates identical idempotency keys across different credential owners", async () => {
    const key = prefix + ":owner-isolation";
    const first = await supabaseAdmin.rpc("bridge_submit_command", args(ownerA, key));
    const second = await supabaseAdmin.rpc("bridge_submit_command", args(ownerB, key));
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect((first.data as { action: string }).action).toBe("accepted");
    expect((second.data as { action: string }).action).toBe("accepted");
    expect((first.data as { record: { id: string } }).record.id)
      .not.toBe((second.data as { record: { id: string } }).record.id);

    const { data: foreign } = await supabaseAdmin.from("bridge_commands")
      .select("id").eq("key_id", ownerB).eq("idempotency_key", key).maybeSingle();
    expect(foreign?.id).toBe((second.data as { record: { id: string } }).record.id);
  });

  it("does not escalate legacy read/dispatch keys and checks scope inside the RPC", async () => {
    const { data: before, error: readError } = await supabaseAdmin.from("bridge_keys")
      .select("scopes").eq("id", legacyOwner).single();
    expect(readError).toBeNull();
    expect(before?.scopes).toEqual(["read", "dispatch"]);

    const denied = await supabaseAdmin.rpc("bridge_submit_command", args(legacyOwner, prefix + ":legacy-denied"));
    expect(denied.error).not.toBeNull();
    expect(denied.error?.message).toContain("BRIDGE_COMMAND_SCOPE_DENIED");

    const { data: after } = await supabaseAdmin.from("bridge_keys")
      .select("scopes").eq("id", legacyOwner).single();
    expect(after?.scopes).toEqual(["read", "dispatch"]);
  });

  it("rejects duplicate scopes at the database constraint", async () => {
    const random = crypto.randomUUID();
    const { error } = await supabaseAdmin.from("bridge_keys").insert({
      label: prefix + ":duplicate-scope",
      key_hash: random.replaceAll("-", "").padEnd(64, "1").slice(0, 64),
      key_prefix: "m1-duplicate",
      scopes: ["read", "read"],
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    });
    expect(error?.code).toBe("23514");
  });

  it("does not expose bridge_commands to the anonymous Data API role", async () => {
    const url = process.env["SUPABASE_URL"];
    const publicKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
    if (!url || !publicKey) throw new Error("Missing local publishable key for privilege assertion");
    const publicClient = createClient(url, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const headers = new Headers(
            typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
          );
          if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
          if (publicKey.startsWith("sb_") && headers.get("Authorization") === "Bearer " + publicKey) {
            headers.delete("Authorization");
          }
          headers.set("apikey", publicKey);
          return nativeFetch(input, { ...init, headers });
        },
      },
    });
    const { error } = await publicClient.from("bridge_commands").select("id");
    expect(error).not.toBeNull();
  });
});
