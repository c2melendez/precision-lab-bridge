import { createServerFn } from "@tanstack/react-start";

// Read-only historical inspection; validation and authorization run inside the server module.
export const inspectHistory = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => d)
  .handler(async ({ data }) => {
    const { inspectHistoricalRun } = await import("./admin-history.server");
    return inspectHistoricalRun(data);
  });