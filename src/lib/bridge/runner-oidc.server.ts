const OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const OIDC_AUDIENCE = "precision-lab-bridge";
const TRUSTED_RUNNERS = {
  "c2melendez/precision-lab-lite": {
    repositoryId: "1342436850",
    workflowRef: "c2melendez/precision-lab-lite/.github/workflows/bridge-command-runner.yml@refs/heads/main",
  },
  "c2melendez/precision-lab-plus": {
    repositoryId: "1342296647",
    workflowRef: "c2melendez/precision-lab-plus/.github/workflows/bridge-command-runner.yml@refs/heads/main",
  },
} as const;

type RunnerRepository = keyof typeof TRUSTED_RUNNERS;
export type VerifiedRunnerIdentity = {
  repository: RunnerRepository;
  repositoryId: string;
  runId: string;
  runAttempt: number;
  workflowRef: string;
};

type JwtHeader = { alg?: string; kid?: string; typ?: string };
type JwtClaims = Record<string, unknown> & {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
  repository?: string;
  repository_id?: string;
  repository_owner?: string;
  event_name?: string;
  ref?: string;
  ref_type?: string;
  workflow_ref?: string;
  run_id?: string;
  run_attempt?: string;
};

type JwkSet = { keys?: JsonWebKey[] };

export class RunnerAuthError extends Error {
  constructor(public readonly code: string, public readonly httpStatus: number = 401) {
    super(code);
  }
}

let cachedJwks: { keys: JsonWebKey[]; expiresAt: number } | null = null;

function decodeSegment(segment: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(segment) || segment.length > 16_384) {
    throw new RunnerAuthError("RUNNER_TOKEN_INVALID");
  }
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (segment.length % 4)) % 4);
  try {
    const binary = atob(base64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new RunnerAuthError("RUNNER_TOKEN_INVALID");
  }
}

function parseJsonSegment<T>(segment: string): T {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decodeSegment(segment))) as T;
  } catch {
    throw new RunnerAuthError("RUNNER_TOKEN_INVALID");
  }
}

function base64UrlDecode(segment: string): Uint8Array {
  return decodeSegment(segment);
}

async function loadSigningKeys(): Promise<JsonWebKey[]> {
  if (cachedJwks && cachedJwks.expiresAt > Date.now()) return cachedJwks.keys;

  let response: Response;
  try {
    response = await fetch(OIDC_ISSUER + "/.well-known/jwks", {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new RunnerAuthError("RUNNER_IDENTITY_PROVIDER_UNAVAILABLE", 503);
  }
  if (response.status >= 300 && response.status < 400) {
    throw new RunnerAuthError("RUNNER_IDENTITY_PROVIDER_INVALID", 502);
  }
  if (!response.ok || !(response.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    throw new RunnerAuthError("RUNNER_IDENTITY_PROVIDER_UNAVAILABLE", 503);
  }

  let body: JwkSet;
  try { body = await response.json() as JwkSet; }
  catch { throw new RunnerAuthError("RUNNER_IDENTITY_PROVIDER_INVALID", 502); }
  if (!Array.isArray(body.keys) || body.keys.length < 1 || body.keys.length > 16) {
    throw new RunnerAuthError("RUNNER_IDENTITY_PROVIDER_INVALID", 502);
  }

  const cacheControl = response.headers.get("cache-control") ?? "";
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/i)?.[1] ?? "300");
  const ttlMs = Math.min(Math.max(Number.isFinite(maxAge) ? maxAge : 300, 60), 900) * 1000;
  cachedJwks = { keys: body.keys, expiresAt: Date.now() + ttlMs };
  return body.keys;
}

function audienceMatches(audience: unknown): boolean {
  return audience === OIDC_AUDIENCE ||
    (Array.isArray(audience) && audience.includes(OIDC_AUDIENCE));
}

function parseIdentity(claims: JwtClaims): VerifiedRunnerIdentity {
  const repository = claims.repository;
  if (typeof repository !== "string" || !(repository in TRUSTED_RUNNERS)) {
    throw new RunnerAuthError("RUNNER_REPOSITORY_NOT_ALLOWED", 403);
  }
  const trusted = TRUSTED_RUNNERS[repository as RunnerRepository];
  const repositoryId = String(claims.repository_id ?? "");
  const runId = String(claims.run_id ?? "");
  const runAttempt = Number(claims.run_attempt);
  const workflowRef = claims.workflow_ref;

  if (repositoryId !== trusted.repositoryId ||
    claims.repository_owner !== "c2melendez" ||
    claims.iss !== OIDC_ISSUER ||
    !audienceMatches(claims.aud) ||
    claims.sub !== "repo:" + repository + ":ref:refs/heads/main" ||
    claims.event_name !== "workflow_dispatch" ||
    claims.ref !== "refs/heads/main" ||
    claims.ref_type !== "branch" ||
    workflowRef !== trusted.workflowRef ||
    !/^[1-9][0-9]{0,19}$/.test(runId) ||
    !Number.isSafeInteger(runAttempt) || runAttempt < 1 || runAttempt > 20) {
    throw new RunnerAuthError("RUNNER_IDENTITY_NOT_AUTHORIZED", 403);
  }

  return {
    repository: repository as RunnerRepository,
    repositoryId,
    runId,
    runAttempt,
    workflowRef: workflowRef as string,
  };
}

export async function verifyRunnerOidcToken(token: string): Promise<VerifiedRunnerIdentity> {
  if (typeof token !== "string" || token.length < 200 || token.length > 16_384) {
    throw new RunnerAuthError("RUNNER_TOKEN_INVALID");
  }
  const parts = token.split(".");
  if (parts.length !== 3) throw new RunnerAuthError("RUNNER_TOKEN_INVALID");

  const header = parseJsonSegment<JwtHeader>(parts[0]);
  const claims = parseJsonSegment<JwtClaims>(parts[1]);
  if (header.alg !== "RS256" || typeof header.kid !== "string" ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(header.kid)) {
    throw new RunnerAuthError("RUNNER_TOKEN_INVALID");
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || typeof claims.iat !== "number" ||
    typeof claims.nbf !== "number" ||
    claims.exp <= now || claims.iat > now + 30 || claims.nbf > now + 30 ||
    claims.exp - claims.iat > 900 || now - claims.iat > 900) {
    throw new RunnerAuthError("RUNNER_TOKEN_EXPIRED");
  }

  const keys = await loadSigningKeys();
  const jwk = keys.find((item) => (item as JsonWebKey & { kid?: string }).kid === header.kid);
  if (!jwk || jwk.kty !== "RSA" || (jwk as JsonWebKey & { use?: string }).use === "enc") {
    throw new RunnerAuthError("RUNNER_SIGNING_KEY_NOT_FOUND");
  }

  let valid = false;
  try {
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      base64UrlDecode(parts[2]),
      new TextEncoder().encode(parts[0] + "." + parts[1]),
    );
  } catch {
    throw new RunnerAuthError("RUNNER_TOKEN_INVALID");
  }
  if (!valid) throw new RunnerAuthError("RUNNER_TOKEN_SIGNATURE_INVALID");

  return parseIdentity(claims);
}

export async function hashLeaseToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
