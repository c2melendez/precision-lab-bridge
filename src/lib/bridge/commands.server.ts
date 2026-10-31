import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checkKey, prefixOf } from "./core.server";
import { commandExecutionEnabled, dispatchAcceptedCommand, type DispatchOutcome } from "./runner-dispatch.server";
import { fingerprintCommand, parseCommandEnvelope, type CommandEnvelope } from "./commands";
import {
  fetchObserverGatePlan,
  fetchObserverStatus,
  ObserverError,
  type ObserverRepositoryStatus,
} from "./observer.server";

type CommandRecord = {
  id: string;
  key_id: string;
  idempotency_key: string;
  command_type: string;
  target_repo: string;
  expected_branch: string;
  expected_sha: string;
  status: string;
  response?: Record<string, unknown> | null;
  correlation_id: string;
  validation_id: string;
  created_at: string;
  updated_at: string;
  replay_count: number;
  attempt_count: number;
  completed_at: string | null;
  error_code: string | null;
  actions_run_id: string | null;
  commit_sha: string | null;
  pull_request_number: number | null;
  pull_request_url: string | null;
};

export type ServiceResult = { status: number; body: Record<string, unknown> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function authenticate(key: string | null, requiredScope: string) {
  if (!key || key.length > 200) {
    return { error: { status: 401, body: { error: "invalid, expired or revoked key" } } } as const;
  }
  let credential: Awaited<ReturnType<typeof checkKey>>;
  try { credential = await checkKey(key); }
  catch { return { error: { status: 503, body: { error: "AUTH_STORE_UNAVAILABLE" } } } as const; }
  if (!credential) {
    return { error: { status: 401, body: { error: "invalid, expired or revoked key" } } } as const;
  }
  if (!Array.isArray(credential.scopes) || !credential.scopes.includes(requiredScope)) {
    return { error: { status: 403, body: { error: "insufficient_scope", required_scope: requiredScope } } } as const;
  }
  return { credential } as const;
}

function publicReceipt(record: Partial<CommandRecord>) {
  return {
    command_id: record.id,
    command_type: record.command_type,
    target_repo: record.target_repo,
    expected_branch: record.expected_branch,
    expected_sha: record.expected_sha,
    status: record.status,
    correlation_id: record.correlation_id,
    validation_id: record.validation_id,
    created_at: record.created_at,
    updated_at: record.updated_at,
    replay_count: record.replay_count,
    ...(record.error_code ? { error_code: record.error_code } : {}),
    ...(record.actions_run_id ? { actions_run_id: record.actions_run_id } : {}),
    ...(record.commit_sha ? { commit_sha: record.commit_sha } : {}),
    ...(record.pull_request_number ? { pull_request_number: record.pull_request_number } : {}),
    ...(record.pull_request_url ? { pull_request_url: record.pull_request_url } : {}),
    execution_enabled: commandExecutionEnabled(),
  };
}

function contextSnapshot(status: ObserverRepositoryStatus, servedAt: string) {
  return {
    repo: status.repo,
    repository_full_name: status.repository_full_name,
    canonical_branch: status.canonical_branch,
    current_head_sha: status.current_head_sha,
    state_status: status.state_status,
    continuity_revision: status.continuity_revision,
    observed_at: servedAt,
  };
}

async function findExisting(keyId: string, idempotencyKey: string) {
  const { data, error } = await supabaseAdmin.from("bridge_commands")
    .select("observer_context")
    .eq("key_id", keyId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) throw new Error("COMMAND_STORE_UNAVAILABLE");
  return data?.observer_context && isRecord(data.observer_context) ? data.observer_context : null;
}

async function persistOrReplay(
  keyId: string,
  envelope: CommandEnvelope,
  fingerprint: string,
  observerContext: Record<string, unknown>,
): Promise<ServiceResult> {
  const { data, error } = await supabaseAdmin.rpc("bridge_submit_command", {
    p_key_id: keyId,
    p_idempotency_key: envelope.idempotency_key,
    p_command_type: envelope.command_type,
    p_target_repo: envelope.target_repo,
    p_expected_branch: envelope.expected_branch,
    p_expected_sha: envelope.expected_sha,
    p_fingerprint: fingerprint,
    p_payload: envelope.payload as never,
    p_observer_context: observerContext as never,
    p_correlation_id: envelope.correlation_id,
    p_validation_id: envelope.validation_id,
  });
  if (error) {
    if (error.message.includes("BRIDGE_COMMAND_SCOPE_DENIED")) {
      return { status: 403, body: { error: "insufficient_scope", required_scope: "command:submit" } };
    }
    if (error.message.includes("BRIDGE_COMMAND_INVALID")) {
      return { status: 422, body: { error: "COMMAND_INVALID" } };
    }
    return { status: 503, body: { error: "COMMAND_STORE_UNAVAILABLE" } };
  }
  if (!isRecord(data) || !["accepted", "replay", "conflict"].includes(String(data.action))) {
    return { status: 503, body: { error: "COMMAND_STORE_UNAVAILABLE" } };
  }
  if (data.action === "conflict") {
    return { status: 409, body: { error: "IDEMPOTENCY_CONFLICT" } };
  }
  if (!isRecord(data.record)) return { status: 503, body: { error: "COMMAND_STORE_UNAVAILABLE" } };
  const record = data.record as Partial<CommandRecord>;
  const accepted = data.action === "accepted";
  return {
    status: accepted ? 202 : 200,
    body: isRecord(record.response) ? record.response : publicReceipt(record),
  };
}

async function audit(endpoint: string, key: string, envelope: CommandEnvelope, result: ServiceResult) {
  try {
    await supabaseAdmin.from("bridge_calls").insert({
      endpoint,
      key_prefix: prefixOf(key),
      params: {
        command_type: envelope.command_type,
        target_repo: envelope.target_repo,
        expected_branch: envelope.expected_branch,
        expected_sha: envelope.expected_sha,
      } as never,
      http_status: result.status,
      result: {
        command_id: result.body["command_id"] ?? null,
        error: result.body["error"] ?? null,
        execution_enabled: commandExecutionEnabled(),
      } as never,
    });
  } catch { /* audit must never mask a durable command result */ }
}

export async function submitCommand(
  endpoint: string,
  key: string | null,
  raw: unknown,
  idempotencyHeader: string | null,
): Promise<ServiceResult> {
  const auth = await authenticate(key, "command:submit");
  if ("error" in auth) return auth.error;
  const parsed = parseCommandEnvelope(raw, idempotencyHeader);
  if (!parsed.ok) return { status: parsed.status, body: { error: parsed.error } };
  const envelope = parsed.envelope;
  const fingerprint = await fingerprintCommand(envelope);

  // Replays return the original durable receipt, even after the observed HEAD moves.
  // A new command is persisted only after a fresh Observer decision.
  try {
    const previousContext = await findExisting(auth.credential.id, envelope.idempotency_key);
    if (previousContext) {
      const replay = await persistOrReplay(auth.credential.id, envelope, fingerprint, previousContext);
      await audit(endpoint, key!, envelope, replay);
      return replay;
    }
  } catch {
    return { status: 503, body: { error: "COMMAND_STORE_UNAVAILABLE" } };
  }

  let observed: Awaited<ReturnType<typeof fetchObserverStatus>>;
  try {
    observed = await fetchObserverStatus(envelope.target_repo);
  } catch (error) {
    const status = error instanceof ObserverError ? error.httpStatus : 503;
    const code = error instanceof ObserverError ? error.code : "OBSERVER_UNAVAILABLE";
    return { status, body: { error: code } };
  }
  const current = observed.repositories.find((item) => item.repo === envelope.target_repo);
  if (!current) return { status: 502, body: { error: "OBSERVER_INCOMPLETE_RESPONSE" } };

  if (current.state_status !== "CURRENT" ||
    current.canonical_branch !== envelope.expected_branch ||
    current.current_head_sha !== envelope.expected_sha) {
    // A parallel request may have committed while this request was reading Observer.
    try {
      const previousContext = await findExisting(auth.credential.id, envelope.idempotency_key);
      if (previousContext) {
        const replay = await persistOrReplay(auth.credential.id, envelope, fingerprint, previousContext);
        await audit(endpoint, key!, envelope, replay);
        return replay;
      }
    } catch {
      return { status: 503, body: { error: "COMMAND_STORE_UNAVAILABLE" } };
    }
    return {
      status: 409,
      body: {
        error: current.state_status !== "CURRENT"
          ? "OBSERVER_STATE_REQUIRES_RECONCILIATION" : "STALE_EXPECTED_HEAD",
        canonical_branch: current.canonical_branch,
        current_head_sha: current.current_head_sha,
        state_status: current.state_status,
      },
    };
  }

  const result = await persistOrReplay(
    auth.credential.id,
    envelope,
    fingerprint,
    contextSnapshot(current, observed.served_at),
  );
  if (result.status === 202 && typeof result.body["command_id"] === "string") {
    const executionEnabled = commandExecutionEnabled();
    result.body["execution_enabled"] = executionEnabled;
    if (executionEnabled) {
      let dispatch: DispatchOutcome | null;
      try {
        dispatch = await dispatchAcceptedCommand(
          result.body["command_id"] as string,
          envelope.target_repo,
        );
      } catch {
        return {
          status: 503,
          body: {
            command_id: result.body["command_id"],
            status: "accepted",
            execution_enabled: true,
            error_code: "COMMAND_DISPATCH_INTENT_UNAVAILABLE",
            reconcile_with_original_idempotency_key: true,
          },
        };
      }
      if (dispatch) {
        if (!dispatch.recorded) {
          return {
            status: 503,
            body: {
              command_id: result.body["command_id"],
              status: dispatch.commandStatus,
              execution_enabled: true,
              dispatch_outcome: dispatch.outcome,
              error_code: dispatch.errorCode ?? "DISPATCH_RECEIPT_PERSISTENCE_UNCERTAIN",
              ...(dispatch.actionsRunId ? { actions_run_id: dispatch.actionsRunId } : {}),
              reconcile_with_original_idempotency_key: true,
            },
          };
        }
        result.body = {
          ...result.body,
          status: dispatch.commandStatus,
          dispatch_outcome: dispatch.outcome,
          execution_enabled: true,
          ...(dispatch.actionsRunId ? { actions_run_id: dispatch.actionsRunId } : {}),
          ...(dispatch.errorCode ? { error_code: dispatch.errorCode } : {}),
        };
      }
    }
  }
  await audit(endpoint, key!, envelope, result);
  return result;
}

const COMMAND_COLUMNS =
  "id,key_id,idempotency_key,command_type,target_repo,expected_branch,expected_sha,status,correlation_id,validation_id,created_at,updated_at,replay_count,attempt_count,completed_at,error_code,actions_run_id,commit_sha,pull_request_number,pull_request_url";

async function findOwnedCommand(keyId: string, selector: { id?: string; idempotencyKey?: string }) {
  const query = supabaseAdmin.from("bridge_commands").select(COMMAND_COLUMNS).eq("key_id", keyId);
  const filtered = selector.id
    ? query.eq("id", selector.id)
    : query.eq("idempotency_key", selector.idempotencyKey!);
  const { data, error } = await filtered.maybeSingle();
  if (error) throw new Error("COMMAND_STORE_UNAVAILABLE");
  return data as CommandRecord | null;
}

export async function getCommand(key: string | null, commandId: string): Promise<ServiceResult> {
  const auth = await authenticate(key, "command:read");
  if ("error" in auth) return auth.error;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(commandId)) {
    return { status: 404, body: { error: "not found" } };
  }
  try {
    const record = await findOwnedCommand(auth.credential.id, { id: commandId });
    return record
      ? { status: 200, body: publicReceipt(record) }
      : { status: 404, body: { error: "not found" } };
  } catch { return { status: 503, body: { error: "COMMAND_STORE_UNAVAILABLE" } }; }
}

export async function lookupCommand(key: string | null, idempotencyKey: string | null): Promise<ServiceResult> {
  const auth = await authenticate(key, "command:read");
  if ("error" in auth) return auth.error;
  if (!idempotencyKey || !/^[A-Za-z0-9._:-]{1,200}$/.test(idempotencyKey)) {
    return { status: 400, body: { error: "Idempotency-Key header is required" } };
  }
  try {
    const record = await findOwnedCommand(auth.credential.id, { idempotencyKey });
    return record
      ? { status: 200, body: publicReceipt(record) }
      : { status: 404, body: { error: "not found" } };
  } catch { return { status: 503, body: { error: "COMMAND_STORE_UNAVAILABLE" } }; }
}

export async function getCapabilities(key: string | null): Promise<ServiceResult> {
  const auth = await authenticate(key, "context:read");
  if ("error" in auth) return auth.error;
  return {
    status: 200,
    body: {
      api_version: "1.0.0",
      authentication: "X-Bridge-Key",
      supported_commands: ["repo.inspect", "repo.patch", "repo.validate"],
      required_scopes: {
        context: "context:read",
        submit: "command:submit",
        command_receipts: "command:read",
      },
      transports: ["REST", "OpenAPI 3.1"],
      execution_enabled: false,
    },
  };
}

export async function getContextStatus(key: string | null, repo: "lite" | "plus" | "both"): Promise<ServiceResult> {
  const auth = await authenticate(key, "context:read");
  if ("error" in auth) return auth.error;
  try {
    return { status: 200, body: await fetchObserverStatus(repo) as unknown as Record<string, unknown> };
  } catch (error) {
    const status = error instanceof ObserverError ? error.httpStatus : 503;
    const code = error instanceof ObserverError ? error.code : "OBSERVER_UNAVAILABLE";
    return { status, body: { error: code } };
  }
}

export async function getContextGatePlan(key: string | null, gate: string, repo: "lite" | "plus"): Promise<ServiceResult> {
  const auth = await authenticate(key, "context:read");
  if ("error" in auth) return auth.error;
  try {
    return { status: 200, body: await fetchObserverGatePlan(gate, repo) };
  } catch (error) {
    const status = error instanceof ObserverError ? error.httpStatus : 503;
    const code = error instanceof ObserverError ? error.code : "OBSERVER_UNAVAILABLE";
    return { status, body: { error: code } };
  }
}
