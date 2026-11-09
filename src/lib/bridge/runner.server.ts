import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { hashLeaseToken, type VerifiedRunnerIdentity } from "./runner-oidc.server";

const COMMAND_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEASE_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA40 = /^[0-9a-f]{40}$/;
const ERROR_CODE = /^[A-Z0-9_]{3,100}$/;
const VALIDATION_PROFILES = ["unit", "lint", "typecheck", "build"] as const;

type RunnerResult = {
  validation_profile?: string;
  validation_conclusion?: "success" | "failure" | "not_run";
  summary?: string;
  base_sha?: string;
  head_sha?: string;
  commit_sha?: string;
  pull_request_number?: number;
  pull_request_url?: string;
  runner_run_url?: string;
};

export type RunnerServiceResult = {
  status: number;
  body: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mapDatabaseError(message: string): RunnerServiceResult {
  if (message.includes("BRIDGE_COMMAND_NOT_FOUND")) return { status: 404, body: { error: "COMMAND_NOT_FOUND" } };
  if (message.includes("BRIDGE_RUNNER_IDENTITY_INVALID") ||
    message.includes("BRIDGE_RUNNER_COMMAND_MISMATCH")) {
    return { status: 403, body: { error: "RUNNER_IDENTITY_NOT_AUTHORIZED" } };
  }
  if (message.includes("BRIDGE_RUNNER_LEASE_INVALID")) return { status: 409, body: { error: "RUNNER_LEASE_INVALID" } };
  if (message.includes("BRIDGE_COMMAND_ATTEMPTS_EXHAUSTED")) return { status: 409, body: { error: "RUNNER_ATTEMPTS_EXHAUSTED" } };
  if (message.includes("BRIDGE_COMMAND_NOT_CLAIMABLE")) return { status: 409, body: { error: "COMMAND_NOT_CLAIMABLE" } };
  if (message.includes("BRIDGE_RUNNER_RESULT_INVALID")) return { status: 422, body: { error: "RUNNER_RESULT_INVALID" } };
  if (message.includes("BRIDGE_COMMAND_DISPATCH_CONFLICT")) return { status: 409, body: { error: "COMMAND_DISPATCH_CONFLICT" } };
  return { status: 503, body: { error: "COMMAND_STORE_UNAVAILABLE" } };
}

export async function claimRunnerCommand(
  commandId: string,
  identity: VerifiedRunnerIdentity,
): Promise<RunnerServiceResult> {
  if (!COMMAND_ID.test(commandId)) return { status: 404, body: { error: "COMMAND_NOT_FOUND" } };
  const { data, error } = await supabaseAdmin.rpc("bridge_command_claim_runner", {
    p_command_id: commandId,
    p_runner_repository: identity.repository,
    p_run_id: identity.runId,
    p_run_attempt: identity.runAttempt,
  });
  if (error) return mapDatabaseError(error.message);
  if (!isRecord(data) || !["claimed", "replay"].includes(String(data.action)) ||
    typeof data.lease_token !== "string" || !LEASE_TOKEN.test(data.lease_token) ||
    !isRecord(data.manifest) || data.manifest.command_id !== commandId ||
    data.manifest.repository_full_name !== identity.repository ||
    data.manifest.target_repo !== (identity.repository.endsWith("-lite") ? "lite" : "plus") ||
    !["repo.inspect", "repo.patch", "repo.validate"].includes(String(data.manifest.command_type)) ||
    typeof data.manifest.request_fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(data.manifest.request_fingerprint) ||
    typeof data.manifest.actions_run_id !== "string" || data.manifest.actions_run_id !== identity.runId ||
    typeof data.manifest.expected_branch !== "string" ||
    typeof data.manifest.expected_sha !== "string" || !SHA40.test(data.manifest.expected_sha) ||
    typeof data.manifest.correlation_id !== "string" ||
    typeof data.manifest.validation_id !== "string" ||
    !isRecord(data.manifest.payload)) {
    return { status: 503, body: { error: "RUNNER_MANIFEST_INVALID" } };
  }
  return {
    status: 200,
    body: {
      ...data.manifest,
      lease_token: data.lease_token,
      lease_replayed: data.action === "replay",
    },
  };
}

function validateRunnerResult(
  identity: VerifiedRunnerIdentity,
  raw: unknown,
): { ok: true; status: string; errorCode: string | null; result: RunnerResult; leaseToken: string }
  | { ok: false; response: RunnerServiceResult } {
  if (!isRecord(raw) || !Object.keys(raw).every((key) =>
    ["lease_token", "status", "error_code", "result"].includes(key))) {
    return { ok: false, response: { status: 422, body: { error: "RUNNER_CALLBACK_SCHEMA_INVALID" } } };
  }
  const leaseToken = raw.lease_token;
  const finalStatus = raw.status;
  const errorCode = raw.error_code ?? null;
  const result = raw.result;
  if (typeof leaseToken !== "string" || !LEASE_TOKEN.test(leaseToken) ||
    typeof finalStatus !== "string" ||
    !["completed", "awaiting_review", "failed", "blocked", "reconcile_required"].includes(finalStatus) ||
    (errorCode !== null && (typeof errorCode !== "string" || !ERROR_CODE.test(errorCode))) ||
    !isRecord(result) ||
    !Object.keys(result).every((key) => [
      "validation_profile", "validation_conclusion", "summary", "base_sha",
      "head_sha", "commit_sha", "pull_request_number", "pull_request_url", "runner_run_url",
    ].includes(key))) {
    return { ok: false, response: { status: 422, body: { error: "RUNNER_CALLBACK_SCHEMA_INVALID" } } };
  }

  const allowed: RunnerResult = {};
  if (result.validation_profile !== undefined) {
    if (typeof result.validation_profile !== "string" ||
      !(VALIDATION_PROFILES as readonly string[]).includes(result.validation_profile)) {
      return { ok: false, response: { status: 422, body: { error: "RUNNER_CALLBACK_SCHEMA_INVALID" } } };
    }
    allowed.validation_profile = result.validation_profile;
  }
  if (result.validation_conclusion !== undefined) {
    if (!["success", "failure", "not_run"].includes(String(result.validation_conclusion))) {
      return { ok: false, response: { status: 422, body: { error: "RUNNER_CALLBACK_SCHEMA_INVALID" } } };
    }
    allowed.validation_conclusion = result.validation_conclusion as RunnerResult["validation_conclusion"];
  }
  if (result.summary !== undefined) {
    if (typeof result.summary !== "string" || result.summary.length > 2000) {
      return { ok: false, response: { status: 422, body: { error: "RUNNER_CALLBACK_SCHEMA_INVALID" } } };
    }
    allowed.summary = result.summary;
  }
  for (const field of ["base_sha", "head_sha", "commit_sha"] as const) {
    const value = result[field];
    if (value !== undefined) {
      if (typeof value !== "string" || !SHA40.test(value)) {
        return { ok: false, response: { status: 422, body: { error: "RUNNER_CALLBACK_SCHEMA_INVALID" } } };
      }
      allowed[field] = value;
    }
  }
  if (result.pull_request_number !== undefined) {
    if (!Number.isSafeInteger(result.pull_request_number) || (result.pull_request_number as number) < 1) {
      return { ok: false, response: { status: 422, body: { error: "RUNNER_CALLBACK_SCHEMA_INVALID" } } };
    }
    allowed.pull_request_number = result.pull_request_number as number;
  }
  if (result.pull_request_url !== undefined) {
    const expectedPrefix = "https://github.com/" + identity.repository + "/pull/";
    if (typeof result.pull_request_url !== "string" ||
      !/^https:\/\/github\.com\/c2melendez\/precision-lab-(lite|plus)\/pull\/[1-9][0-9]*$/.test(result.pull_request_url) ||
      !result.pull_request_url.startsWith(expectedPrefix)) {
      return { ok: false, response: { status: 422, body: { error: "RUNNER_CALLBACK_SCHEMA_INVALID" } } };
    }
    allowed.pull_request_url = result.pull_request_url;
  }
  if (result.runner_run_url !== undefined) {
    const expectedUrl = "https://github.com/" + identity.repository + "/actions/runs/" + identity.runId;
    if (result.runner_run_url !== expectedUrl) {
      return { ok: false, response: { status: 422, body: { error: "RUNNER_CALLBACK_SCHEMA_INVALID" } } };
    }
    allowed.runner_run_url = expectedUrl;
  }
  if (finalStatus === "awaiting_review" &&
    (!allowed.commit_sha || !allowed.pull_request_number || !allowed.pull_request_url ||
      allowed.validation_conclusion !== "success")) {
    return { ok: false, response: { status: 422, body: { error: "RUNNER_CALLBACK_SCHEMA_INVALID" } } };
  }
  return {
    ok: true,
    status: finalStatus,
    errorCode: errorCode as string | null,
    result: allowed,
    leaseToken,
  };
}

export async function finishRunnerCommand(
  commandId: string,
  identity: VerifiedRunnerIdentity,
  raw: unknown,
): Promise<RunnerServiceResult> {
  if (!COMMAND_ID.test(commandId)) return { status: 404, body: { error: "COMMAND_NOT_FOUND" } };
  const parsed = validateRunnerResult(identity, raw);
  if (!parsed.ok) return parsed.response;

  const tokenHash = await hashLeaseToken(parsed.leaseToken);
  const { data, error } = await supabaseAdmin.rpc("bridge_command_finish_runner", {
    p_command_id: commandId,
    p_runner_repository: identity.repository,
    p_run_id: identity.runId,
    p_lease_token: parsed.leaseToken,
    p_lease_token_hash: tokenHash,
    p_final_status: parsed.status,
    p_error_code: parsed.errorCode,
    p_result: parsed.result as never,
  });
  if (error) return mapDatabaseError(error.message);
  if (!isRecord(data) || !["completed", "replay"].includes(String(data.action)) ||
    !isRecord(data.record) || data.record.id !== commandId) {
    return { status: 503, body: { error: "COMMAND_STORE_UNAVAILABLE" } };
  }
  return {
    status: 200,
    body: {
      command_id: commandId,
      status: data.record.status,
      actions_run_id: data.record.actions_run_id,
      commit_sha: data.record.commit_sha ?? null,
      pull_request_number: data.record.pull_request_number ?? null,
      pull_request_url: data.record.pull_request_url ?? null,
      callback_replayed: data.action === "replay",
    },
  };
}
