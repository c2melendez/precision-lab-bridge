// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyRunnerOidcToken } from "./runner-oidc.server";

const now = Math.floor(Date.now() / 1000);
let privateKey: CryptoKey;
let publicJwk: JsonWebKey & { kid: string; use: string; alg: string };

function b64url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function token(overrides: Record<string, unknown> = {}, invalidSignature = false) {
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid: "m2-test-key" })));
  const claims = {
    iss: "https://token.actions.githubusercontent.com",
    aud: "precision-lab-bridge",
    sub: "repo:c2melendez/precision-lab-lite:ref:refs/heads/main",
    iat: now,
    nbf: now - 1,
    exp: now + 300,
    repository: "c2melendez/precision-lab-lite",
    repository_id: "1342436850",
    repository_owner: "c2melendez",
    event_name: "workflow_dispatch",
    ref: "refs/heads/main",
    ref_type: "branch",
    workflow_ref: "c2melendez/precision-lab-lite/.github/workflows/bridge-command-runner.yml@refs/heads/main",
    run_id: "987654321",
    run_attempt: "1",
    ...overrides,
  };
  const payload = b64url(new TextEncoder().encode(JSON.stringify(claims)));
  const data = new TextEncoder().encode(header + "." + payload);
  const signature = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", privateKey, data,
  ));
  if (invalidSignature) signature[0] = signature[0] ^ 0xff;
  return header + "." + payload + "." + b64url(signature);
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  privateKey = pair.privateKey;
  publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey) as JsonWebKey & {
    kid: string; use: string; alg: string;
  };
  publicJwk.kid = "m2-test-key";
  publicJwk.use = "sig";
  publicJwk.alg = "RS256";
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(
    { keys: [publicJwk] },
    { headers: { "cache-control": "max-age=300" } },
  )));
});

describe("GitHub Actions OIDC runner authentication", () => {
  it("accepts the exact Lite repository, workflow, default branch and workflow_dispatch run", async () => {
    const identity = await verifyRunnerOidcToken(await token());
    expect(identity).toEqual({
      repository: "c2melendez/precision-lab-lite",
      repositoryId: "1342436850",
      runId: "987654321",
      runAttempt: 1,
      workflowRef: "c2melendez/precision-lab-lite/.github/workflows/bridge-command-runner.yml@refs/heads/main",
    });
  });

  it("accepts the corresponding Plus workflow identity", async () => {
    const identity = await verifyRunnerOidcToken(await token({
      sub: "repo:c2melendez/precision-lab-plus:ref:refs/heads/main",
      repository: "c2melendez/precision-lab-plus",
      repository_id: "1342296647",
      workflow_ref: "c2melendez/precision-lab-plus/.github/workflows/bridge-command-runner.yml@refs/heads/main",
    }));
    expect(identity.repository).toBe("c2melendez/precision-lab-plus");
  });

  it("rejects a repository ID mismatch or a repository outside the allowlist", async () => {
    await expect(verifyRunnerOidcToken(await token({ repository_id: "1" })))
      .rejects.toMatchObject({ code: "RUNNER_IDENTITY_NOT_AUTHORIZED", httpStatus: 403 });
    await expect(verifyRunnerOidcToken(await token({
      repository: "attacker/precision-lab-lite",
      repository_id: "1342436850",
    }))).rejects.toMatchObject({ code: "RUNNER_REPOSITORY_NOT_ALLOWED", httpStatus: 403 });
  });

  it("rejects an untrusted ref, workflow, or event", async () => {
    for (const overrides of [
      { ref: "refs/heads/qa/syntax-audit-in625-a1" },
      { workflow_ref: "c2melendez/precision-lab-lite/.github/workflows/certification-runner.yml@refs/heads/main" },
      { event_name: "push" },
      { ref_type: "tag" },
    ]) {
      await expect(verifyRunnerOidcToken(await token(overrides)))
        .rejects.toMatchObject({ code: "RUNNER_IDENTITY_NOT_AUTHORIZED", httpStatus: 403 });
    }
  });

  it("rejects an incorrect audience, issuer and expired token", async () => {
    await expect(verifyRunnerOidcToken(await token({ aud: "other-service" })))
      .rejects.toMatchObject({ code: "RUNNER_IDENTITY_NOT_AUTHORIZED" });
    await expect(verifyRunnerOidcToken(await token({ iss: "https://attacker.example" })))
      .rejects.toMatchObject({ code: "RUNNER_IDENTITY_NOT_AUTHORIZED" });
    await expect(verifyRunnerOidcToken(await token({ exp: now - 10, iat: now - 400 })))
      .rejects.toMatchObject({ code: "RUNNER_TOKEN_EXPIRED" });
  });

  it("rejects a tampered JWT signature", async () => {
    await expect(verifyRunnerOidcToken(await token({}, true)))
      .rejects.toMatchObject({ code: "RUNNER_TOKEN_SIGNATURE_INVALID" });
  });

  it("rejects malformed and oversized bearer values", async () => {
    await expect(verifyRunnerOidcToken("bad.jwt")).rejects.toMatchObject({ code: "RUNNER_TOKEN_INVALID" });
    await expect(verifyRunnerOidcToken("a".repeat(20_000))).rejects.toMatchObject({ code: "RUNNER_TOKEN_INVALID" });
  });
});
