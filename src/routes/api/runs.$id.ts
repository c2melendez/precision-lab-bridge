import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/runs/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { runStatus, respond } = await import("@/lib/bridge/core.server");
        const url = new URL(request.url);
        if (url.searchParams.has("key")) {
          return respond(400, { error: "QUERY_CREDENTIALS_NOT_SUPPORTED" }, request);
        }
        const key = request.headers.get("x-bridge-key");
        const r = await runStatus(key, params.id);
        return respond(r.status, r.body, request);
      },
    },
  },
});