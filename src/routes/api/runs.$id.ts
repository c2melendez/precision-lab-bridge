import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/runs/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { runStatus, respond } = await import("@/lib/bridge/core.server");
        const key = new URL(request.url).searchParams.get("key") ?? request.headers.get("x-bridge-key");
        const r = await runStatus(key, params.id);
        return respond(r.status, r.body, request);
      },
    },
  },
});