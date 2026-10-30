// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ trigger: vi.fn(), lookup: vi.fn(), fetch: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => options }));
vi.mock("@/lib/bridge/core.server", () => ({ trigger: mocks.trigger }));
vi.mock("@/lib/bridge/lookup.server", () => ({ lookupRequest: mocks.lookup }));
import { Route as disabledRoute } from "@/routes/api/run";
import { Route as lookupRoute } from "@/routes/api/runs.lookup";

type ReadRoute = { server: { handlers: { GET: (context: { request: Request }) => Promise<Response> } } };
// Router factory is mocked to expose the exact server handlers, without SSR or network.
const disabled = disabledRoute as unknown as ReadRoute;
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
  it("does not accept query-string credentials in place of X-Bridge-Key", async () => {
    mocks.lookup.mockResolvedValue({ status: 401, body: { error: "invalid, expired or revoked key" } });
    const response = await lookup.server.handlers.GET({ request: new Request(
      "http://localhost/api/runs/lookup?key=plb_test&idempotency_key=v1") });
    expect(mocks.lookup).toHaveBeenCalledWith(null, null);
    expect(response.status).toBe(401);
    expect(mocks.trigger).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});