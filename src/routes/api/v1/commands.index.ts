import { createFileRoute } from "@tanstack/react-router";
import { readBoundedCommandBody } from "@/lib/bridge/commands";

export const Route = createFileRoute("/api/v1/commands/")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (new URL(request.url).searchParams.has("key")) {
          return Response.json({ error: "QUERY_CREDENTIALS_NOT_SUPPORTED" }, {
            status: 400, headers: { "cache-control": "no-store" },
          });
        }
        const boundedBody = await readBoundedCommandBody(request);
        if (!boundedBody.ok) {
          const tooLarge = boundedBody.reason === "too_large";
          return Response.json({ error: tooLarge
            ? "command exceeds the 256 KiB limit"
            : "request body must be valid UTF-8" }, {
            status: tooLarge ? 413 : 400,
            headers: { "cache-control": "no-store" },
          });
        }
        let body: unknown;
        try { body = JSON.parse(boundedBody.text) as unknown; }
        catch {
          return Response.json({ error: "body must be valid JSON" }, {
            status: 400, headers: { "cache-control": "no-store" },
          });
        }
        const { submitCommand } = await import("@/lib/bridge/commands.server");
        const result = await submitCommand(
          "POST /api/v1/commands",
          request.headers.get("x-bridge-key"),
          body,
          request.headers.get("idempotency-key"),
        );
        return Response.json(result.body, {
          status: result.status,
          headers: { "cache-control": "no-store", vary: "X-Bridge-Key, Idempotency-Key" },
        });
      },
    },
  },
});
