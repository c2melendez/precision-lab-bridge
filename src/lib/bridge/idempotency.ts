import type { TriggerParams } from "./validate";

export type IdempotentRequest = TriggerParams & {
  idempotency_key: string;
  validation_id: string;
  correlation_id: string;
  branch: string;
  requested_sha: string | null;
};

// Deliberately explicit, stable ordering; no credentials or arbitrary extra fields.
export function fingerprintPayload(p: IdempotentRequest) {
  return JSON.stringify({
    target_repo: p.target_repo, gate: p.gate, dry_run: p.dry_run,
    validation_id: p.validation_id, correlation_id: p.correlation_id,
    branch: p.branch, requested_sha: p.requested_sha,
  });
}

export function validateIdempotency(raw: Record<string, unknown>, params: TriggerParams, defaultBranch: string):
  | { ok: true; request: IdempotentRequest }
  | { ok: false; error: string } {
  const text = (name: string, fallback?: string) => raw[name] === undefined ? fallback : raw[name];
  const key = text("idempotency_key");
  if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(key))
    return { ok: false, error: "idempotency_key is required (1–200 letters, numbers, . _ : -)" };
  const validation = text("validation_id", key);
  const correlation = text("correlation_id", key);
  if (typeof validation !== "string" || typeof correlation !== "string" ||
    !/^[A-Za-z0-9._:-]{1,200}$/.test(validation) || !/^[A-Za-z0-9._:-]{1,200}$/.test(correlation))
    return { ok: false, error: "validation_id and correlation_id must be safe identifiers (1–200 characters)" };
  const branch = text("branch", defaultBranch);
  if (typeof branch !== "string" || branch.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) ||
    branch.includes("..") || branch.includes("//") || branch.endsWith("/") || branch.endsWith(".lock"))
    return { ok: false, error: "branch must be a valid branch name" };
  const sha = raw["requested_sha"];
  if (sha !== undefined && sha !== null && (typeof sha !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(sha)))
    return { ok: false, error: "requested_sha must be a full 40- or 64-character SHA" };
  return { ok: true, request: { ...params, idempotency_key: key, validation_id: validation,
    correlation_id: correlation, branch, requested_sha: typeof sha === "string" ? sha.toLowerCase() : null } };
}