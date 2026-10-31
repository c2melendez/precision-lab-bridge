// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchObserverGatePlan, fetchObserverStatus, ObserverError } from "./observer.server";

const head = "b".repeat(40);
const validStatus = {
  served_at: "2026-10-30T18:00:00.000Z",
  read_only: true,
  repositories: [{
    repo: "lite",
    repository_full_name: "c2melendez/precision-lab-lite",
    canonical_branch: "qa/syntax-audit-in625-a1",
    current_head_sha: head,
    state_status: "CURRENT",
    continuity_revision: 17,
  }],
};

beforeEach(() => {
  process.env["OBSERVER_BASE_URL"] = "https://precision-lab-readonly-api.onrender.com";
  process.env["OBSERVER_SERVICE_KEY"] = "server-only-test-secret";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env["OBSERVER_BASE_URL"];
  delete process.env["OBSERVER_SERVICE_KEY"];
});

describe("Bridge internal Observer client", () => {
  it("uses only the configured HTTPS origin and server-side API key", async () => {
    const request = vi.fn(async () => Response.json(validStatus));
    vi.stubGlobal("fetch", request);
    const result = await fetchObserverStatus("lite");
    expect(result.repositories[0]).toMatchObject({
      repo: "lite",
      canonical_branch: "qa/syntax-audit-in625-a1",
      current_head_sha: head,
      state_status: "CURRENT",
    });
    const [url, init] = request.mock.calls[0];
    expect(String(url)).toBe("https://precision-lab-readonly-api.onrender.com/v1/status?repo=lite");
    expect(new Headers(init?.headers).get("X-API-Key")).toBe("server-only-test-secret");
    expect(init).toMatchObject({ method: "GET", redirect: "manual", cache: "no-store" });
  });

  it("fails closed when the Observer key is missing", async () => {
    delete process.env["OBSERVER_SERVICE_KEY"];
    await expect(fetchObserverStatus("lite")).rejects.toMatchObject({
      code: "OBSERVER_NOT_CONFIGURED",
      httpStatus: 503,
    });
  });

  it("rejects non-HTTPS bases and bases containing paths or credentials", async () => {
    for (const base of [
      "http://observer.example",
      "https://user:pass@observer.example",
      "https://observer.example/private/path",
      "https://observer.example/?token=x",
    ]) {
      process.env["OBSERVER_BASE_URL"] = base;
      await expect(fetchObserverStatus("lite")).rejects.toBeInstanceOf(ObserverError);
    }
  });

  it("refuses redirects instead of forwarding the internal credential", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://attacker.example/collect" },
    })));
    await expect(fetchObserverStatus("lite")).rejects.toMatchObject({
      code: "OBSERVER_REDIRECT_REJECTED",
      httpStatus: 502,
    });
  });

  it("maps upstream authentication failures to a safe 502", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("private detail", { status: 401 })));
    await expect(fetchObserverStatus("lite")).rejects.toMatchObject({
      code: "OBSERVER_AUTH_FAILED",
      httpStatus: 502,
    });
  });

  it("requires a complete and canonical Observer repository status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      ...validStatus,
      repositories: [{ ...validStatus.repositories[0], current_head_sha: "not-a-sha" }],
    })));
    await expect(fetchObserverStatus("lite")).rejects.toMatchObject({
      code: "OBSERVER_INVALID_RESPONSE",
      httpStatus: 502,
    });
  });

  it("rejects an Observer status that maps a repository to the other project", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      ...validStatus,
      repositories: [{ ...validStatus.repositories[0], repository_full_name: "c2melendez/precision-lab-plus" }],
    })));
    await expect(fetchObserverStatus("lite")).rejects.toMatchObject({
      code: "OBSERVER_INVALID_RESPONSE",
      httpStatus: 502,
    });
  });

  it("fetches the read-only gate plan through the same authenticated origin", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      read_only: true,
      repository_full_name: "c2melendez/precision-lab-lite",
      canonical_branch: "qa/syntax-audit-in625-a1",
      observed_head: head,
      gate: { action_taken: false },
    })));
    const plan = await fetchObserverGatePlan("h1d", "lite");
    expect(plan.action_taken).toBe(false);
    await expect(fetchObserverGatePlan("../secret", "lite")).rejects.toMatchObject({
      code: "INVALID_GATE",
      httpStatus: 400,
    });
  });
});
