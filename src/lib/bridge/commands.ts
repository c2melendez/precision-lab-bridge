export const COMMAND_TYPES = ["repo.inspect", "repo.patch", "repo.validate"] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];
export const VALIDATION_PROFILES = ["unit", "lint", "typecheck", "build"] as const;
export type ValidationProfile = (typeof VALIDATION_PROFILES)[number];
export const MAX_COMMAND_BODY_BYTES = 256 * 1024;
const MAX_PATCH_BYTES = 192 * 1024;
const MAX_FILE_BYTES = 64 * 1024;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,200}$/;
const SHA40 = /^[a-f0-9]{40}$/i;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;
const ENVELOPE_KEYS = [
  "schema_version", "command_type", "target_repo", "expected_branch", "expected_sha",
  "payload", "idempotency_key", "correlation_id", "validation_id",
] as const;

export type CommandEnvelope = {
  schema_version: 1;
  command_type: CommandType;
  target_repo: "lite" | "plus";
  expected_branch: string;
  expected_sha: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  correlation_id: string;
  validation_id: string;
};

export type ParseResult =
  | { ok: true; envelope: CommandEnvelope }
  | { ok: false; status: 400 | 413 | 422; error: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function validBranch(value: string): boolean {
  return BRANCH.test(value) && !value.includes("..") && !value.includes("//") &&
    !value.includes("@{") && !value.endsWith("/") && !value.endsWith(".") &&
    !value.endsWith(".lock") && !value.startsWith(".");
}

function validPath(path: string): boolean {
  if (!path || path.length > 300 || path.startsWith("/") || path.includes("\\") ||
    /^[A-Za-z]:/.test(path) || path.includes("\0")) return false;
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." ||
    part.endsWith(".") || part.endsWith(" "))) return false;
  const lower = path.toLowerCase();
  return !(lower === ".git" || lower.startsWith(".git/") ||
    lower === ".github" || lower.startsWith(".github/") ||
    lower === ".env" || lower.startsWith(".env.") ||
    lower.includes("/.env") || lower === "secrets" || lower.startsWith("secrets/") ||
    lower.includes("/secrets/") || lower.includes("credentials") ||
    lower.endsWith(".pem") || lower.endsWith(".key") || lower.endsWith(".p12") ||
    lower.endsWith(".pfx") || lower.endsWith(".tfstate") ||
    /(^|\/)(id_rsa|id_ed25519|authorized_keys|\.npmrc|\.pypirc)$/i.test(lower));
}

function validatePayload(commandType: CommandType, payload: unknown): string | null {
  if (!isObject(payload)) return "payload must be an object";
  if (commandType === "repo.inspect") {
    return Object.keys(payload).length === 0 ? null : "repo.inspect payload must be empty";
  }
  if (commandType === "repo.validate") {
    if (!onlyKeys(payload, ["profile"]) || typeof payload.profile !== "string" ||
      !(VALIDATION_PROFILES as readonly string[]).includes(payload.profile)) {
      return "repo.validate requires one allowlisted profile: unit, lint, typecheck or build";
    }
    return null;
  }
  if (!onlyKeys(payload, ["operations"]) || !Array.isArray(payload.operations) ||
    payload.operations.length < 1 || payload.operations.length > 40) {
    return "repo.patch requires 1–40 typed file operations";
  }
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const operation of payload.operations) {
    if (!isObject(operation) || typeof operation.action !== "string" ||
      typeof operation.path !== "string" || !validPath(operation.path)) {
      return "patch operation contains an invalid or protected repository path";
    }
    const normalized = operation.path.toLowerCase();
    if (seen.has(normalized)) return "patch operations cannot contain duplicate paths";
    seen.add(normalized);
    if (operation.action === "create") {
      if (!onlyKeys(operation, ["action", "path", "content"]) || typeof operation.content !== "string") {
        return "create operations require only action, path and text content";
      }
      const bytes = new TextEncoder().encode(operation.content).byteLength;
      if (bytes > MAX_FILE_BYTES) return "a file operation exceeds the 64 KiB limit";
      totalBytes += bytes;
    } else if (operation.action === "replace") {
      if (!onlyKeys(operation, ["action", "path", "content", "expected_blob_sha"]) ||
        typeof operation.content !== "string" || typeof operation.expected_blob_sha !== "string" ||
        !SHA40.test(operation.expected_blob_sha)) {
        return "replace operations require text content and a 40-character expected_blob_sha";
      }
      const bytes = new TextEncoder().encode(operation.content).byteLength;
      if (bytes > MAX_FILE_BYTES) return "a file operation exceeds the 64 KiB limit";
      totalBytes += bytes;
    } else if (operation.action === "delete") {
      if (!onlyKeys(operation, ["action", "path", "expected_blob_sha"]) ||
        typeof operation.expected_blob_sha !== "string" || !SHA40.test(operation.expected_blob_sha)) {
        return "delete operations require a 40-character expected_blob_sha";
      }
    } else {
      return "patch action must be create, replace or delete";
    }
    if (totalBytes > MAX_PATCH_BYTES) return "combined patch content exceeds the 192 KiB limit";
  }
  return null;
}

export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const object = value as Record<string, unknown>;
  return "{" + Object.keys(object).sort().map((key) =>
    JSON.stringify(key) + ":" + stableStringify(object[key])).join(",") + "}";
}

export function parseCommandEnvelope(raw: unknown, idempotencyHeader: string | null): ParseResult {
  if (!isObject(raw)) return { ok: false, status: 400, error: "request body must be a JSON object" };
  if (!idempotencyHeader || !SAFE_ID.test(idempotencyHeader)) {
    return { ok: false, status: 400, error: "Idempotency-Key header is required and must be a safe identifier" };
  }
  if (!onlyKeys(raw, ENVELOPE_KEYS)) {
    return { ok: false, status: 422, error: "request contains unknown envelope fields" };
  }
  if (raw.schema_version !== 1 ||
    typeof raw.command_type !== "string" || !(COMMAND_TYPES as readonly string[]).includes(raw.command_type) ||
    (raw.target_repo !== "lite" && raw.target_repo !== "plus") ||
    typeof raw.expected_branch !== "string" || !validBranch(raw.expected_branch) ||
    typeof raw.expected_sha !== "string" || !SHA40.test(raw.expected_sha) ||
    typeof raw.idempotency_key !== "string" || !SAFE_ID.test(raw.idempotency_key) ||
    raw.idempotency_key !== idempotencyHeader ||
    typeof raw.correlation_id !== "string" || !SAFE_ID.test(raw.correlation_id) ||
    typeof raw.validation_id !== "string" || !SAFE_ID.test(raw.validation_id)) {
    return { ok: false, status: 400, error: "invalid command envelope or Idempotency-Key mismatch" };
  }
  const commandType = raw.command_type as CommandType;
  const payloadError = validatePayload(commandType, raw.payload);
  if (payloadError) return { ok: false, status: 422, error: payloadError };
  const envelope: CommandEnvelope = {
    schema_version: 1,
    command_type: commandType,
    target_repo: raw.target_repo,
    expected_branch: raw.expected_branch,
    expected_sha: raw.expected_sha.toLowerCase(),
    payload: raw.payload,
    idempotency_key: raw.idempotency_key,
    correlation_id: raw.correlation_id,
    validation_id: raw.validation_id,
  };
  if (new TextEncoder().encode(stableStringify(envelope)).byteLength > MAX_COMMAND_BODY_BYTES) {
    return { ok: false, status: 413, error: "command exceeds the 256 KiB limit" };
  }
  return { ok: true, envelope };
}

export async function fingerprintCommand(envelope: CommandEnvelope): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableStringify(envelope)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
