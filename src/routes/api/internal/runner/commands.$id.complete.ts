import { createFileRoute } from "@tanstack/react-router";
import { RunnerAuthError, verifyRunnerOidcToken } from "@/lib/bridge/runner-oidc.server";

const MAX_CALLBACK_BYTES = 40 * 1024;

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header || header.length > 17_000) return null;
  const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(header);
  return match?.[1] ?? null;
}

async function readBoundedJson(request: Request): Promise<
  { ok: true; value: unknown } |
  { ok: false; status: 400 | 413; error: string }
> {
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_CALLBACK_BYTES) {
    try { await request.body?.cancel(); } catch { /* reject without buffering */ }
    return { ok: false, status: 413, error: "CALLBACK_TOO_LARGE" };
  }
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, status: 400, error: "CALLBACK_BODY_REQUIRED" };
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_CALLBACK_BYTES) {
        try { await reader.cancel(); } catch { /* already cancelled */ }
        return { ok: false, status: 413, error: "CALLBACK_TOO_LARGE" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, error: "CALLBACK_BODY_INVALID" };
  } finally {
    try { reader.releaseLock(); } catch { /* no-op */ }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    return { ok: true, value };
  } catch {
    return { ok: false, status: 400, error: "CALLBACK_BODY_INVALID" };
  }
}

export const Route = createFileRoute("/api/internal/runner/commands/$id/complete")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const token = bearer(request);
        if (!token) {
          return Response.json({ error: "RUNNER_IDENTITY_REQUIRED" }, {
            status: 401, headers: { "cache-control": "no-store" },
          });
        }
        const parsed = await readBoundedJson(request);
        if (!parsed.ok) {
          return Response.json({ error: parsed.error }, {
            status: parsed.status, headers: { "cache-control": "no-store" },
          });
        }
        try {
          const identity = await verifyRunnerOidcToken(token);
          const { finishRunnerCommand } = await import("@/lib/bridge/runner.server");
          const result = await finishRunnerCommand(params.id, identity, parsed.value);
          return Response.json(result.body, {
            status: result.status,
            headers: { "cache-control": "no-store", vary: "Authorization" },
          });
        } catch (error) {
          const status = error instanceof RunnerAuthError ? error.httpStatus : 503;
          const code = error instanceof RunnerAuthError ? error.code : "RUNNER_AUTHENTICATION_UNAVAILABLE";
          return Response.json({ error: code }, {
            status, headers: { "cache-control": "no-store", vary: "Authorization" },
          });
        }
      },
    },
  },
});
