// @vitest-environment node
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ select: vi.fn(), contains: vi.fn(), eq: vi.fn(), limit: vi.fn(), single: vi.fn(),
  fetch: vi.fn(), rpc: vi.fn(), insert: vi.fn(), update: vi.fn(), upsert: vi.fn(), remove: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: m.from, rpc: m.rpc } }));
import { inspectHistoricalRun } from "./admin-history.server";

const RUN = 40461232174;
const row = { id: "idem1", key_id: "oldkey", state: "RUNNING", run_id: "br1", created_at: "c", updated_at: "u",
  gh_runs: [{ repo: "precision-lab-lite", run_id: RUN, html_url: "h" }] };
const revoked = { id: "oldkey", revoked_at: "2026-10-28" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", m.fetch);
  vi.spyOn(console, "info").mockImplementation(() => {});
  process.env["BRIDGE_ADMIN_PASSWORD"] = "admin-pw";
  process.env["GH_TOKEN"] = "tok"; process.env["GH_OWNER"] = "c2melendez";
  const q = { select: m.select, contains: m.contains, eq: m.eq, limit: m.limit, maybeSingle: m.single };
  m.from.mockReturnValue({ ...q, insert: m.insert, update: m.update, upsert: m.upsert, delete: m.remove });
  m.select.mockReturnValue(q); m.contains.mockReturnValue(q); m.eq.mockReturnValue(q);
});

function stores(rows: unknown, key: unknown = revoked) {
  m.limit.mockResolvedValueOnce({ data: rows, error: null });
  m.single.mockResolvedValueOnce({ data: key, error: null });
}
function gh(status: string, conclusion: string | null) {
  m.fetch.mockResolvedValue({ ok: true, json: async () => ({ status, conclusion, html_url: "h" }) });
}
function expectNoWrites() {
  for (const f of [m.rpc, m.insert, m.update, m.upsert, m.remove]) expect(f).not.toHaveBeenCalled();
  for (const [url, init] of m.fetch.mock.calls) {
    expect(String(url)).not.toContain("dispatches");
    expect((init as RequestInit).method).toBe("GET");
  }
}
function expectNoReads() { expect(m.from).not.toHaveBeenCalled(); expect(m.fetch).not.toHaveBeenCalled(); }
const call = (extra: object = {}) => inspectHistoricalRun({ password: "admin-pw", run_id: RUN, ...extra });

describe("admin historical inspection is read-only", () => {
  it.each([["success", "SUCCEEDED"], ["failure", "FAILED"]])("observes %s without persisting", async (c, obs) => {
    stores([row]); gh("completed", c);
    const r = await call();
    expect(r).toMatchObject({ ok: true, stored_state: "RUNNING", observed_state: obs, persisted: false });
    expect(JSON.stringify(r)).not.toMatch(/key_prefix|key_hash|lease_token|tok\b/);
    expect(m.select).toHaveBeenNthCalledWith(2, "id, revoked_at");
    expect(m.contains).toHaveBeenCalledWith("gh_runs", [{ run_id: RUN }]);
    expect(m.eq).toHaveBeenCalledWith("id", "oldkey");
    expectNoWrites();
  });
  it("reports in-progress runs as RUNNING", async () => {
    stores([row]); gh("in_progress", null);
    expect(await call()).toMatchObject({ observed_state: "RUNNING", persisted: false });
    expectNoWrites();
  });
  it.each(["reject", "status"])("GitHub %s error yields UNKNOWN", async (kind) => {
    stores([row]);
    if (kind === "reject") m.fetch.mockRejectedValue(new Error("x")); else m.fetch.mockResolvedValue({ ok: false, status: 500 });
    expect(await call()).toMatchObject({ ok: true, stored_state: "RUNNING", observed_state: "UNKNOWN", persisted: false });
    expectNoWrites();
  });
  it.each([{ password: "wrong" }, { password: "" }])("auth failure before any read", async (extra) => {
    const r = await call(extra);
    expect(r.ok).toBe(false);
    expectNoReads();
  });
  it("missing admin secret denies", async () => {
    delete process.env["BRIDGE_ADMIN_PASSWORD"];
    expect(await call()).toEqual({ ok: false, error: "UNAUTHORIZED" });
    expectNoReads();
  });
  it("non-allowlisted run ID is NOT_FOUND before reads", async () => {
    expect(await call({ run_id: 40624157231 })).toEqual({ ok: false, error: "NOT_FOUND" });
    expectNoReads();
  });
  it.each([{ extra: 1 }, { run_id: "40461232174" }, { run_id: -1 }])("strict input rejects %o", async (extra) => {
    expect(await call(extra)).toEqual({ ok: false, error: "INVALID_INPUT" });
    expectNoReads();
  });
  it("active (non-revoked) owning key is NOT_FOUND", async () => {
    stores([row], { ...revoked, revoked_at: null });
    expect(await call()).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(m.fetch).not.toHaveBeenCalled(); expectNoWrites();
  });
  it.each([[[]], [[{ ...row, state: "SUCCEEDED" }]], [[row, row]]])("final/absent/ambiguous rows are NOT_FOUND", async (rows) => {
    stores(rows);
    expect(await call()).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(m.eq).toHaveBeenCalledWith("state", "RUNNING");
    expect(m.fetch).not.toHaveBeenCalled(); expectNoWrites();
  });
  it.each([
    ["wrong repo", [{ repo: "evil-repo", run_id: RUN, html_url: "x" }]],
    ["mixed allowed+unallowed", [{ repo: "precision-lab-lite", run_id: RUN }, { repo: "precision-lab-plus", run_id: 999 }]],
    ["mismatched requested ID", [{ repo: "precision-lab-lite", run_id: 40461306085 }]],
    ["non-numeric id", [{ repo: "precision-lab-lite", run_id: String(RUN) }]],
  ])("%s is NOT_FOUND with no run details, fetch or writes", async (_n, gh_runs) => {
    stores([{ ...row, gh_runs }]);
    const r = await call();
    expect(r).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(m.fetch).not.toHaveBeenCalled(); expectNoWrites();
  });
  it("fetches only allowlisted repo/run URLs and ignores stored URLs", async () => {
    stores([row]); m.fetch.mockRejectedValue(new Error("x"));
    const r = await call();
    expect(r).toMatchObject({ runs: [{ repo: "precision-lab-lite", run_id: RUN, url: null }] });
    expect(m.fetch).toHaveBeenCalledTimes(1);
    expect(String(m.fetch.mock.calls[0]![0])).toBe(`https://api.github.com/repos/c2melendez/precision-lab-lite/actions/runs/${RUN}`);
    expectNoWrites();
  });
  it("storage error is generic", async () => {
    m.limit.mockResolvedValueOnce({ data: null, error: { message: "secret detail" } });
    expect(await call()).toEqual({ ok: false, error: "STATUS_STORE_UNAVAILABLE" });
  });
  it("logs never contain the password or token", async () => {
    stores([row]); gh("completed", "success");
    await call(); await call({ password: "wrong" });
    const logged = vi.mocked(console.info).mock.calls.flat().join(" ");
    expect(logged).not.toMatch(/admin-pw|wrong|tok\b/);
  });
  it("module imports no write-capable bridge modules or write APIs", () => {
    const src = readFileSync(new URL("./admin-history.server.ts", import.meta.url), "utf8").replace(/^\/\/.*$/gm, "");
    for (const bad of ["core.server", "idempotency.server", "lookup.server", "reconcileRunning",
      ".update(", ".insert(", ".delete(", ".upsert(", ".rpc(", "dispatches", "\"POST\""]) expect(src).not.toContain(bad);
  });
});