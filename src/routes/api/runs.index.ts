import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/runs/")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { trigger, respond } = await import("@/lib/bridge/core.server");
        let body: Record<string, unknown> = {};
        try {
          const j = await request.json();
          if (j && typeof j === "object") body = j as Record<string, unknown>;
        } catch {
          return respond(400, { error: "body must be JSON" }, request);
        }
        const r = await trigger("POST /api/runs", request.headers.get("x-bridge-key"), {
          ...body, idempotency_key: request.headers.get("idempotency-key") ?? body["idempotency_key"],
        });
        return respond(r.status, r.body, request);
      },
    },
  },
});