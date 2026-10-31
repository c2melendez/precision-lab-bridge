const OWNER = "c2melendez";
const WORKFLOW_FILE = "bridge-command-runner.yml";
const RUNNER_REF = "main";
const REPOSITORIES = {
  lite: "precision-lab-lite",
  plus: "precision-lab-plus",
} as const;

export type DispatchOutcome = {
  outcome: "queued" | "blocked" | "reconcile_required";
  actionsRunId: string | null;
  actionsRunUrl: string | null;
  errorCode: string | null;
  recorded: boolean;
  commandStatus: "validating" | "queued" | "blocked" | "reconcile_required";
};

function safeRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function enabled(): boolean {
  return process.env["BRIDGE_COMMAND_EXECUTION_ENABLED"] === "true";
}

export function commandExecutionEnabled(): boolean {
  return enabled() && Boolean(process.env["GH_TOKEN"]);
}

function token(): string {
  const value = process.env["GH_TOKEN"];
  if (!value || value.length > 500) throw new Error("GITHUB_DISPATCH_NOT_CONFIGURED");
  return value;
}

async function github(path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch("https://api.github.com/" + path, {
      ...init,
      method: init.method ?? "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + token(),
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "precision-lab-bridge",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("GITHUB_DISPATCH_OUTCOME_UNKNOWN");
  }
  if (response.status >= 300 && response.status < 400) {
    throw new Error("GITHUB_DISPATCH_REDIRECT_REJECTED");
  }
  return response;
}

async function findDispatchRun(
  repository: string,
  commandId: string,
  startedAtMs: number,
): Promise<{ id: string; url: string } | null> {
  const workflow = encodeURIComponent(WORKFLOW_FILE);
  const response = await github(
    "repos/" + OWNER + "/" + repository + "/actions/workflows/" + workflow +
    "/runs?event=workflow_dispatch&branch=" + RUNNER_REF + "&per_page=100",
  );
  if (!response.ok) throw new Error("GITHUB_DISPATCH_OUTCOME_UNKNOWN");
  const body: unknown = await response.json().catch(() => null);
  if (!safeRecord(body) || !Array.isArray(body.workflow_runs)) {
    throw new Error("GITHUB_DISPATCH_RESPONSE_INVALID");
  }
  const expectedTitle = "Bridge command " + commandId;
  const matches = body.workflow_runs.filter((item) =>
    safeRecord(item) &&
    item.display_title === expectedTitle &&
    item.head_branch === RUNNER_REF &&
    typeof item.created_at === "string" &&
    Date.parse(item.created_at) >= startedAtMs - 30_000 &&
    typeof item.id === "number" && Number.isSafeInteger(item.id) && item.id > 0 &&
    typeof item.html_url === "string" &&
    item.html_url === "https://github.com/" + OWNER + "/" + repository + "/actions/runs/" + item.id,
  );
  if (matches.length > 1) throw new Error("GITHUB_DISPATCH_AMBIGUOUS");
  if (matches.length === 0) return null;
  return { id: String(matches[0].id), url: matches[0].html_url as string };
}

async function resolveRun(
  repository: string,
  commandId: string,
  startedAtMs: number,
): Promise<{ id: string; url: string }> {
  // workflow_dispatch returns 204 and no run ID. Only an exact run-name match is attachable.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const found = await findDispatchRun(repository, commandId, startedAtMs);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("GITHUB_DISPATCH_RUN_NOT_FOUND");
}

async function beginDispatch(commandId: string): Promise<"started" | "already_started" | "already_terminal"> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("bridge_command_begin_dispatch", {
    p_command_id: commandId,
  });
  if (error || !safeRecord(data) || !["started", "replay"].includes(String(data.action)) ||
    !safeRecord(data.record)) {
    throw new Error("COMMAND_DISPATCH_INTENT_UNAVAILABLE");
  }
  if (data.action === "started") return "started";
  return data.record.status === "validating" ? "already_started" : "already_terminal";
}

async function recordOutcome(commandId: string, outcome: DispatchOutcome): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const args = {
    p_command_id: commandId,
    p_outcome: outcome.outcome,
    p_actions_run_id: outcome.actionsRunId,
    p_actions_run_url: outcome.actionsRunUrl,
    p_error_code: outcome.errorCode,
  };
  const first = await supabaseAdmin.rpc("bridge_command_record_dispatch", args);
  if (!first.error) return true;
  // A lost database response is reconciled with the identical outcome, never a redispatch.
  const retry = await supabaseAdmin.rpc("bridge_command_record_dispatch", args);
  return !retry.error;
}

export async function dispatchAcceptedCommand(
  commandId: string,
  targetRepo: "lite" | "plus",
): Promise<DispatchOutcome | null> {
  if (!enabled()) return null;

  const intent = await beginDispatch(commandId);
  if (intent !== "started") {
    return {
      outcome: intent === "already_started" ? "reconcile_required" : "blocked",
      actionsRunId: null,
      actionsRunUrl: null,
      errorCode: intent === "already_started"
        ? "DISPATCH_INTENT_ALREADY_EXISTS_RECONCILE_BEFORE_RETRY"
        : "COMMAND_ALREADY_DISPATCHED_OR_TERMINAL",
      recorded: true,
      commandStatus: intent === "already_started" ? "validating" : "blocked",
    };
  }

  const repo = OWNER + "/" + REPOSITORIES[targetRepo];
  const startedAtMs = Date.now();
  const endpoint = "repos/" + repo + "/actions/workflows/" +
    encodeURIComponent(WORKFLOW_FILE) + "/dispatches";
  let outcome: DispatchOutcome;

  try {
    const response = await github(endpoint, {
      method: "POST",
      body: JSON.stringify({
        ref: RUNNER_REF,
        inputs: { command_id: commandId },
      }),
    });
    if ([401, 403, 404, 422].includes(response.status)) {
      outcome = {
        outcome: "blocked",
        actionsRunId: null,
        actionsRunUrl: null,
        errorCode: "GITHUB_DISPATCH_REJECTED_" + response.status,
      };
    } else if (response.status !== 204 && !response.ok) {
      // An unexpected status may still have created a run: reconcile by exact run-name before giving up.
      const run = await resolveRun(repo, commandId, startedAtMs).catch(() => null);
      outcome = run ? {
        outcome: "queued", actionsRunId: run.id, actionsRunUrl: run.url, errorCode: null,
      } : {
        outcome: "reconcile_required",
        actionsRunId: null,
        actionsRunUrl: null,
        errorCode: "GITHUB_DISPATCH_OUTCOME_UNKNOWN",
      };
    } else {
      const run = await resolveRun(repo, commandId, startedAtMs);
      outcome = {
        outcome: "queued",
        actionsRunId: run.id,
        actionsRunUrl: run.url,
        errorCode: null,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "GITHUB_DISPATCH_OUTCOME_UNKNOWN";
    // Network failures are ambiguous; look for the uniquely named run but never POST again.
    const run = await resolveRun(repo, commandId, startedAtMs).catch(() => null);
    outcome = run ? {
      outcome: "queued", actionsRunId: run.id, actionsRunUrl: run.url, errorCode: null,
    } : {
      outcome: message.includes("REJECTED") ? "blocked" : "reconcile_required",
      actionsRunId: null,
      actionsRunUrl: null,
      errorCode: /^[A-Z0-9_]{3,100}$/.test(message) ? message : "GITHUB_DISPATCH_OUTCOME_UNKNOWN",
    };
  }

  let recorded = false;
  try { recorded = await recordOutcome(commandId, outcome); }
  catch { recorded = false; }
  if (!recorded) {
    return {
      outcome: "reconcile_required",
      actionsRunId: outcome.actionsRunId,
      actionsRunUrl: outcome.actionsRunUrl,
      errorCode: "DISPATCH_RECEIPT_PERSISTENCE_UNCERTAIN",
      recorded: false,
      commandStatus: "validating",
    };
  }
  return {
    ...outcome,
    recorded: true,
    commandStatus: outcome.outcome,
  };
}
