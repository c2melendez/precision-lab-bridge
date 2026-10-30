import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Tables, Json } from "@/integrations/supabase/types";
import { fingerprintPayload, type IdempotentRequest } from "./idempotency";

export type ClaimRecord = Tables<"bridge_idempotency">;
export type Claim = { action: "claimed" | "replay" | "busy"; record: ClaimRecord } | { action: "conflict" };

export async function claimRequest(keyId: string, p: IdempotentRequest, hash: (s: string) => Promise<string>): Promise<Claim> {
  const payload = JSON.parse(fingerprintPayload(p)) as Json;
  const { data, error } = await supabaseAdmin.rpc("bridge_claim", {
    p_key: p.idempotency_key, p_key_id: keyId, p_fingerprint: await hash(fingerprintPayload(p)),
    p_payload: payload, p_validation_id: p.validation_id, p_correlation_id: p.correlation_id,
    // Generated RPC types do not represent nullable PostgreSQL parameters.
    p_repo: p.target_repo, p_branch: p.branch, p_sha: p.requested_sha as unknown as string,
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) throw new Error("CLAIM_UNAVAILABLE");
  const claim = data as unknown as Claim;
  if (!["claimed", "replay", "busy", "conflict"].includes(claim.action)) throw new Error("CLAIM_UNAVAILABLE");
  return claim;
}

export async function prepareRun(record: ClaimRecord) {
  if (!record.lease_token) throw new Error("CLAIM_NOT_OWNED");
  const { data, error } = await supabaseAdmin.rpc("bridge_prepare", { p_id: record.id, p_token: record.lease_token });
  if (error || !data) throw new Error("PREPARE_FAILED");
  return data;
}

export async function beginDispatch(record: ClaimRecord, repo: string) {
  if (!record.lease_token) throw new Error("CLAIM_NOT_OWNED");
  const { data, error } = await supabaseAdmin.rpc("bridge_begin_dispatch", { p_id: record.id, p_token: record.lease_token, p_repo: repo });
  if (error || data !== true) throw new Error("CLAIM_NOT_OWNED");
}

export async function recordDispatch(record: ClaimRecord, run: { repo: string; run_id: number | null; html_url: string | null }) {
  if (!record.lease_token) throw new Error("CLAIM_NOT_OWNED");
  const { data, error } = await supabaseAdmin.rpc("bridge_record_dispatch", { p_id: record.id, p_token: record.lease_token, p_run: run });
  if (error || data !== true) throw new Error("DISPATCH_RECORD_FAILED");
}

export async function finishClaim(record: ClaimRecord, state: string, status: number, response: Json, errorCode?: string) {
  if (!record.lease_token) throw new Error("CLAIM_NOT_OWNED");
  const { data, error } = await supabaseAdmin.rpc("bridge_finish", {
    p_id: record.id, p_token: record.lease_token, p_state: state, p_status: status, p_response: response,
    ...(errorCode ? { p_error: errorCode } : {}),
  });
  if (error || data !== true) throw new Error("FINISH_FAILED");
}