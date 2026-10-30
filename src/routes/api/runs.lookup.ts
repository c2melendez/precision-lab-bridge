import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/runs/lookup")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { lookupRequest } = await import("@/lib/bridge/lookup.server");
        const result = await lookupRequest(request.headers.get("x-bridge-key"), request.headers.get("idempotency-key"));
        return Response.json(result.body, {
          status: result.status,
          headers: { "cache-control": "no-store", "vary": "X-Bridge-Key, Idempotency-Key" },
        });
      },
    },
  },
});