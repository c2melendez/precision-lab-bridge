import { createFileRoute } from "@tanstack/react-router";
import { MAX_COMMAND_BODY_BYTES } from "@/lib/bridge/commands";

export const Route = createFileRoute("/api/v1/commands/")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (new URL(request.url).searchParams.has("key")) {
          return Response.json({ error: "QUERY_CREDENTIALS_NOT_SUPPORTED" }, {
            status: 400, headers: { "cache-control": "no-store" },
          });
        }
        const raw = await request.text();
        if (new TextEncoder().encode(raw).byteLength > MAX_COMMAND_BODY_BYTES) {
          return Response.json({ error: "command exceeds the 256 KiB limit" }, {
            status: 413, headers: { "cache-control": "no-store" },
          });
        }
        let body: unknown;
        try { body = JSON.parse(raw) as unknown; }
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
