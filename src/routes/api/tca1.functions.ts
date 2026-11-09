import { createFileRoute } from "@tanstack/react-router";
import { handleTca1FunctionGatewayRequest } from "@/lib/tca/tca1-function-gateway.server";

export const Route = createFileRoute("/api/tca1/functions")({
  server: {
    handlers: {
      GET: async ({ request }) => handleTca1FunctionGatewayRequest(request),
      POST: async ({ request }) => handleTca1FunctionGatewayRequest(request),
    },
  },
});
