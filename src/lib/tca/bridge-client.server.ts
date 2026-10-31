import type { CommandEnvelope } from "@/lib/bridge/commands";
import { parseCommandEnvelope } from "@/lib/bridge/commands";
import { parseTca1BridgeBaseUrl, type Tca1RuntimeConfig } from "./tca1-policy";

export type Tca1Repo = "lite" | "plus" | "both";

export class Tca1BridgeError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: string,
  ) {
    super(code);
    this.name = "Tca1BridgeError";
  }
}

export type Tca1Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type Tca1BridgeClient = {
  getCapabilities(): Promise<Record<string, unknown>>;
  getContextStatus(repo?: Tca1Repo): Promise<Record<string, unknown>>;
  getGatePlan(gate: string, repo: "lite" | "plus"): Promise<Record<string, unknown>>;
  submitCommand(envelope: CommandEnvelope): Promise<Record<string, unknown>>;
  getCommand(commandId: string): Promise<Record<string, unknown>>;
  lookupCommand(idempotencyKey: string): Promise<Record<string, unknown>>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeErrorCode(value: unknown, status: number): string {
  if (isRecord(value) && typeof value["error"] === "string" &&
    /^[A-Z][A-Z0-9_]{0,79}$/.test(value["error"])) {
    return value["error"];
  }
  return `BRIDGE_HTTP_${status}`;
}

const SAFE_ID = /^[A-Za-z0-9._:-]{1,200}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createTca1BridgeClient(
  config: Pick<Tca1RuntimeConfig, "baseUrl" | "apiKey" | "timeoutMs">,
  options: { fetcher?: Tca1Fetch } = {},
): Tca1BridgeClient {
  const baseUrl = parseTca1BridgeBaseUrl(config.baseUrl);
  if (!config.apiKey || config.apiKey.trim() !== config.apiKey ||
    config.apiKey.length < 16 || config.apiKey.length > 200) {
    throw new Error("TCA1_BRIDGE_KEY_MISSING_OR_INVALID");
  }
  if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1_000 || config.timeoutMs > 30_000) {
    throw new Error("TCA1_HTTP_TIMEOUT_OUT_OF_RANGE");
  }
  const fetcher = options.fetcher ?? fetch;

  async function request(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      const headers = new Headers(init.headers);
      headers.set("Accept", "application/json");
      headers.set("X-Bridge-Key", config.apiKey);
      if (init.body) headers.set("Content-Type", "application/json");
      response = await fetcher(new URL(path, `${baseUrl}/`), {
        ...init,
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(config.timeoutMs),
        headers,
      });
    } catch {
      // Never include the request URL, headers or fetch exception: they may contain secrets.
      throw new Tca1BridgeError(0, "BRIDGE_NETWORK_OR_TIMEOUT");
    }

    let body: unknown = null;
    try { body = await response.json(); } catch { /* reject malformed/empty JSON below */ }
    if (!response.ok) throw new Tca1BridgeError(response.status, safeErrorCode(body, response.status));
    if (!isRecord(body)) throw new Tca1BridgeError(response.status, "BRIDGE_INVALID_JSON_RESPONSE");
    return body;
  }

  return {
    getCapabilities: () => request("/api/v1/capabilities"),
    getContextStatus: (repo = "both") => {
      if (repo !== "lite" && repo !== "plus" && repo !== "both") {
        throw new Error("TCA1_INVALID_REPOSITORY");
      }
      return request(`/api/v1/context/status?repo=${repo}`);
    },
    getGatePlan: (gate, repo) => {
      if (!/^[A-Za-z0-9._-]{1,100}$/.test(gate)) throw new Error("TCA1_INVALID_GATE");
      if (repo !== "lite" && repo !== "plus") throw new Error("TCA1_INVALID_REPOSITORY");
      return request(`/api/v1/context/gates/${encodeURIComponent(gate)}/plan?repo=${repo}`);
    },
    submitCommand: (raw) => {
      const parsed = parseCommandEnvelope(raw, raw.idempotency_key);
      if (!parsed.ok) throw new Error("TCA1_INVALID_COMMAND_ENVELOPE");
      return request("/api/v1/commands", {
        method: "POST",
        headers: { "Idempotency-Key": parsed.envelope.idempotency_key },
        body: JSON.stringify(parsed.envelope),
      });
    },
    getCommand: (commandId) => {
      if (!UUID.test(commandId)) throw new Error("TCA1_INVALID_COMMAND_ID");
      return request(`/api/v1/commands/${commandId}`);
    },
    lookupCommand: (idempotencyKey) => {
      if (!SAFE_ID.test(idempotencyKey)) throw new Error("TCA1_INVALID_IDEMPOTENCY_KEY");
      return request("/api/v1/commands/lookup", {
        headers: { "Idempotency-Key": idempotencyKey },
      });
    },
  };
}
