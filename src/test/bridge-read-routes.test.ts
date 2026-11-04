// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ trigger: vi.fn(), runStatus: vi.fn(), lookup: vi.fn(), fetch: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => options }));
vi.mock("@/lib/bridge/core.server", () => ({
  trigger: mocks.trigger,
  runStatus: mocks.runStatus,
  respond: (status: number, body: unknown) => Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  }),
}));
vi.mock("@/lib/bridge/lookup.server", () => ({ lookupRequest: mocks.lookup }));
import { Route as disabledRoute } from "@/routes/api/run";
import { Route as statusRoute } from "@/routes/api/runs.$id";
import { Route as lookupRoute } from "@/routes/api/runs.lookup";

type ReadRoute = {
  server: {
    handlers: {
      GET: (context: { request: Request; params?: { id: string } }) => Promise<Response>;
    };
  };
};
// Router factory is mocked to expose the exact server handlers, without SSR or network.
const disabled = disabledRoute as unknown as ReadRoute;
const status = statusRoute as unknown as ReadRoute;
const lookup = lookupRoute as unknown as ReadRoute;

beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", mocks.fetch); });

describe("GET bridge routes never dispatch", () => {
  it.each(["http://localhost/api/run", "http://localhost/api/run?key=plb_test&target_repo=lite&gate=h1d&dry_run=true&idempotency_key=v1"])(
    "returns 405 even when legacy trigger parameters are supplied", async (url) => {
      const response = await disabled.server.handlers.GET({ request: new Request(url,
        { headers: { "X-Bridge-Key": "plb_test", "Idempotency-Key": "v1" } }) });
      expect(response.status).toBe(405);
      expect(await response.json()).toEqual({ error: "METHOD_NOT_ALLOWED" });
      expect(mocks.trigger).not.toHaveBeenCalled();
      expect(mocks.lookup).not.toHaveBeenCalled();
      expect(mocks.fetch).not.toHaveBeenCalled();
    });
  it("authenticates lookup with both headers and returns the stored result without trigger", async () => {
    const body = { state: "BLOCKED", run_id: "run1", status_url: "/api/runs/run1", runs: [{ run_id: 42, html_url: "u" }] };
    mocks.lookup.mockResolvedValue({ status: 200, body });
    const response = await lookup.server.handlers.GET({ request: new Request("http://localhost/api/runs/lookup", {
      headers: { "X-Bridge-Key": "plb_test", "Idempotency-Key": "v1" },
    }) });
    expect(mocks.lookup).toHaveBeenCalledWith("plb_test", "v1");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(body);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.trigger).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("rejects query-string credentials instead of passing them to the lookup handler", async () => {
    const response = await lookup.server.handlers.GET({ request: new Request(
      "http://localhost/api/runs/lookup?key=plb_test&idempotency_key=v1") });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "QUERY_CREDENTIALS_NOT_SUPPORTED" });
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.trigger).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("uses only X-Bridge-Key for run status authentication", async () => {
    const id = "00000000-0000-0000-0000-000000000001";
    mocks.runStatus.mockResolvedValue({ status: 200, body: { id } });
    const response = await status.server.handlers.GET({
      request: new Request(`http://localhost/api/runs/${id}`, {
        headers: { "X-Bridge-Key": "plb_header" },
      }),
      params: { id },
    });
    expect(mocks.runStatus).toHaveBeenCalledWith("plb_header", id);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects query-string credentials for run status, even when a header is present", async () => {
    const id = "00000000-0000-0000-0000-000000000001";
    const response = await status.server.handlers.GET({
      request: new Request(`http://localhost/api/runs/${id}?key=plb_query`, {
        headers: { "X-Bridge-Key": "plb_header" },
      }),
      params: { id },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "QUERY_CREDENTIALS_NOT_SUPPORTED" });
    expect(mocks.runStatus).not.toHaveBeenCalled();
  });

});