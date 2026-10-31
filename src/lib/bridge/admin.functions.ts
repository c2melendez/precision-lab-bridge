import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createTca1KeyInputSchema, scopesForTca1AccessMode, tca1ExpiryIso } from "@/lib/tca/tca1-policy";

async function assertAdmin(password: string) {
  const expected = process.env["BRIDGE_ADMIN_PASSWORD"];
  if (!expected) throw new Error("Admin password not configured");
  const { sha256 } = await import("./core.server");
  if ((await sha256(password)) !== (await sha256(expected))) throw new Error("Wrong admin password");
}

const pw = z.string().min(1).max(200);

export const listAdmin = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ password: pw }).parse(d))
  .handler(async ({ data }) => {
    await assertAdmin(data.password);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [keys, calls] = await Promise.all([
      supabaseAdmin.from("bridge_keys").select("id,label,key_prefix,scopes,created_at,expires_at,revoked_at,last_used_at").order("created_at", { ascending: false }),
      supabaseAdmin.from("bridge_calls").select("*").order("created_at", { ascending: false }).limit(50),
    ]);
    return { keys: keys.data ?? [], calls: calls.data ?? [] };
  });

export const createKey = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      password: pw,
      label: z.string().trim().min(1).max(80),
      days: z.number().int().min(1).max(365),
      scopes: z.array(z.enum(["read", "dispatch", "context:read", "command:submit", "command:read"]))
        .min(1).max(5).refine((scopes) => new Set(scopes).size === scopes.length, "scopes must be unique")
        .default(["read"]),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    await assertAdmin(data.password);
    const { newKey, sha256, prefixOf } = await import("./core.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const key = newKey();
    const { error } = await supabaseAdmin.from("bridge_keys").insert({
      label: data.label,
      key_hash: await sha256(key),
      key_prefix: prefixOf(key),
      scopes: data.scopes,
      expires_at: new Date(Date.now() + data.days * 86_400_000).toISOString(),
    });
    if (error) throw new Error(error.message);
    return { key };
  });


export const createTca1Key = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => createTca1KeyInputSchema.parse(d))
  .handler(async ({ data }) => {
    await assertAdmin(data.password);
    const { newKey, sha256, prefixOf } = await import("./core.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const key = newKey();
    const scopes = scopesForTca1AccessMode(data.accessMode);
    const expiresAt = tca1ExpiryIso(data.ttlMinutes);
    const { data: created, error } = await supabaseAdmin.from("bridge_keys")
      .insert({
        label: data.label,
        key_hash: await sha256(key),
        key_prefix: prefixOf(key),
        scopes,
        expires_at: expiresAt,
      })
      .select("id")
      .single();
    if (error || !created?.id) throw new Error("TCA1_KEY_CREATE_FAILED");
    // The raw key is returned once to the admin UI only; only hash/prefix are persisted.
    return {
      key,
      key_id: created.id,
      key_prefix: prefixOf(key),
      scopes,
      expires_at: expiresAt,
    };
  });

export const revokeKey = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ password: pw, id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await assertAdmin(data.password);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("bridge_keys").update({ revoked_at: new Date().toISOString() }).eq("id", data.id);
    return { ok: true };
  });