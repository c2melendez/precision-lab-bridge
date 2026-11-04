import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/context/gates/$gate/plan")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        if (url.searchParams.has("key")) {
          return Response.json({ error: "QUERY_CREDENTIALS_NOT_SUPPORTED" }, {
            status: 400, headers: { "cache-control": "no-store" },
          });
        }
        const repo = url.searchParams.get("repo");
        if (repo !== "lite" && repo !== "plus") {
          return Response.json({ error: "repo must be lite or plus" }, {
            status: 400, headers: { "cache-control": "no-store" },
          });
        }
        const { getContextGatePlan } = await import("@/lib/bridge/commands.server");
        const result = await getContextGatePlan(request.headers.get("x-bridge-key"), params.gate, repo);
        return Response.json(result.body, {
          status: result.status,
          headers: { "cache-control": "no-store", vary: "X-Bridge-Key" },
        });
      },
    },
  },
});
