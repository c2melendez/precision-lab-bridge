import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/run")({
  server: {
    handlers: {
      GET: async () => Response.json({ error: "METHOD_NOT_ALLOWED" }, {
        status: 405,
        headers: { "cache-control": "no-store" },
      }),
    },
  },
});