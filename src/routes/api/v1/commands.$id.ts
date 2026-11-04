import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/commands/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (new URL(request.url).searchParams.has("key")) {
          return Response.json({ error: "QUERY_CREDENTIALS_NOT_SUPPORTED" }, {
            status: 400, headers: { "cache-control": "no-store" },
          });
        }
        const { getCommand } = await import("@/lib/bridge/commands.server");
        const result = await getCommand(request.headers.get("x-bridge-key"), params.id);
        return Response.json(result.body, {
          status: result.status,
          headers: { "cache-control": "no-store", vary: "X-Bridge-Key" },
        });
      },
    },
  },
});
