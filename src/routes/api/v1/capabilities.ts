import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/capabilities")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (new URL(request.url).searchParams.has("key")) {
          return Response.json({ error: "QUERY_CREDENTIALS_NOT_SUPPORTED" }, {
            status: 400, headers: { "cache-control": "no-store" },
          });
        }
        const { getCapabilities } = await import("@/lib/bridge/commands.server");
        const result = await getCapabilities(request.headers.get("x-bridge-key"));
        return Response.json(result.body, {
          status: result.status,
          headers: { "cache-control": "no-store", vary: "X-Bridge-Key" },
        });
      },
    },
  },
});
