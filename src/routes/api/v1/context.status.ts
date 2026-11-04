import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/context/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.has("key")) {
          return Response.json({ error: "QUERY_CREDENTIALS_NOT_SUPPORTED" }, {
            status: 400, headers: { "cache-control": "no-store" },
          });
        }
        const repo = url.searchParams.get("repo") ?? "both";
        if (repo !== "lite" && repo !== "plus" && repo !== "both") {
          return Response.json({ error: "repo must be lite, plus or both" }, {
            status: 400, headers: { "cache-control": "no-store" },
          });
        }
        const { getContextStatus } = await import("@/lib/bridge/commands.server");
        const result = await getContextStatus(request.headers.get("x-bridge-key"), repo);
        return Response.json(result.body, {
          status: result.status,
          headers: { "cache-control": "no-store", vary: "X-Bridge-Key" },
        });
      },
    },
  },
});
