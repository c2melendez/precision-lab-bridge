import { createFileRoute } from "@tanstack/react-router";
import { RunnerAuthError, verifyRunnerOidcToken } from "@/lib/bridge/runner-oidc.server";

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header || header.length > 17_000) return null;
  const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(header);
  return match?.[1] ?? null;
}

export const Route = createFileRoute("/api/internal/runner/commands/$id/claim")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (request.headers.get("content-length") && request.headers.get("content-length") !== "0") {
          return Response.json({ error: "REQUEST_BODY_NOT_ALLOWED" }, {
            status: 400, headers: { "cache-control": "no-store" },
          });
        }
        const token = bearer(request);
        if (!token) {
          return Response.json({ error: "RUNNER_IDENTITY_REQUIRED" }, {
            status: 401, headers: { "cache-control": "no-store" },
          });
        }
        try {
          const identity = await verifyRunnerOidcToken(token);
          const { claimRunnerCommand } = await import("@/lib/bridge/runner.server");
          const result = await claimRunnerCommand(params.id, identity);
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
