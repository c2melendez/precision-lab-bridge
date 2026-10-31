export type ObserverRepo = "lite" | "plus" | "both";

export type ObserverRepositoryStatus = {
  repo: "lite" | "plus";
  repository_full_name: string;
  canonical_branch: string;
  current_head_sha: string;
  state_status: "CURRENT" | "RECONCILE" | "REFRESH";
  continuity_revision: number;
};

export type ObserverStatus = {
  served_at: string;
  read_only: true;
  repositories: ObserverRepositoryStatus[];
  warnings?: string[];
};

export class ObserverError extends Error {
  constructor(public readonly code: string, public readonly httpStatus: number) {
    super(code);
  }
}

function observerOrigin(): { origin: string; key: string } {
  const base = process.env["OBSERVER_BASE_URL"];
  const key = process.env["OBSERVER_SERVICE_KEY"];
  if (!base || !key) throw new ObserverError("OBSERVER_NOT_CONFIGURED", 503);
  let url: URL;
  try { url = new URL(base); }
  catch { throw new ObserverError("OBSERVER_CONFIGURATION_INVALID", 503); }
  if (url.protocol !== "https:" || url.username || url.password ||
    url.pathname !== "/" || url.search || url.hash) {
    throw new ObserverError("OBSERVER_CONFIGURATION_INVALID", 503);
  }
  return { origin: url.origin, key };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function observerGet(path: string): Promise<unknown> {
  const { origin, key } = observerOrigin();
  let response: Response;
  try {
    response = await fetch(new URL(path, origin), {
      method: "GET",
      headers: { Accept: "application/json", "X-API-Key": key },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(7_000),
    });
  } catch {
    throw new ObserverError("OBSERVER_UNAVAILABLE", 503);
  }
  if (response.status >= 300 && response.status < 400) {
    throw new ObserverError("OBSERVER_REDIRECT_REJECTED", 502);
  }
  if (!response.ok) {
    throw new ObserverError(response.status === 401 || response.status === 403
      ? "OBSERVER_AUTH_FAILED" : "OBSERVER_UPSTREAM_ERROR", 502);
  }
  if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    throw new ObserverError("OBSERVER_INVALID_RESPONSE", 502);
  }
  try { return await response.json(); }
  catch { throw new ObserverError("OBSERVER_INVALID_RESPONSE", 502); }
}

function expectedRepositoryFullName(repo: "lite" | "plus"): string {
  return repo === "lite" ? "c2melendez/precision-lab-lite" : "c2melendez/precision-lab-plus";
}

export async function fetchObserverStatus(repo: ObserverRepo = "both"): Promise<ObserverStatus> {
  const raw = await observerGet("/v1/status?repo=" + encodeURIComponent(repo));
  if (!isRecord(raw) || raw.read_only !== true || typeof raw.served_at !== "string" ||
    !Array.isArray(raw.repositories)) throw new ObserverError("OBSERVER_INVALID_RESPONSE", 502);
  const repositories: ObserverRepositoryStatus[] = [];
  for (const item of raw.repositories) {
    if (!isRecord(item) || (item.repo !== "lite" && item.repo !== "plus") ||
      item.repository_full_name !== expectedRepositoryFullName(item.repo) || typeof item.canonical_branch !== "string" ||
      typeof item.current_head_sha !== "string" || !/^[a-f0-9]{40}$/i.test(item.current_head_sha) ||
      !["CURRENT", "RECONCILE", "REFRESH"].includes(String(item.state_status)) ||
      !Number.isInteger(item.continuity_revision)) {
      throw new ObserverError("OBSERVER_INVALID_RESPONSE", 502);
    }
    repositories.push({
      repo: item.repo,
      repository_full_name: item.repository_full_name,
      canonical_branch: item.canonical_branch,
      current_head_sha: item.current_head_sha.toLowerCase(),
      state_status: item.state_status as ObserverRepositoryStatus["state_status"],
      continuity_revision: item.continuity_revision as number,
    });
  }
  const expected = repo === "both" ? ["lite", "plus"] : [repo];
  if (expected.some((name) => repositories.filter((item) => item.repo === name).length !== 1)) {
    throw new ObserverError("OBSERVER_INCOMPLETE_RESPONSE", 502);
  }
  return {
    served_at: raw.served_at,
    read_only: true,
    repositories,
    ...(Array.isArray(raw.warnings)
      ? { warnings: raw.warnings.filter((v): v is string => typeof v === "string").slice(0, 20) }
      : {}),
  };
}

export async function fetchObserverGatePlan(gate: string, repo: "lite" | "plus"): Promise<Record<string, unknown>> {
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(gate)) throw new ObserverError("INVALID_GATE", 400);
  const raw = await observerGet("/v1/gates/" + encodeURIComponent(gate) + "/plan?repo=" + repo + "&refresh=true");
  if (!isRecord(raw) || raw.read_only !== true || raw.repository_full_name !== expectedRepositoryFullName(repo) ||
    !isRecord(raw.gate) || raw.gate.action_taken !== false || typeof raw.canonical_branch !== "string" || typeof raw.observed_head !== "string" ||
    !/^[a-f0-9]{40}$/i.test(raw.observed_head)) {
    throw new ObserverError("OBSERVER_INVALID_RESPONSE", 502);
  }
  return raw;
}
