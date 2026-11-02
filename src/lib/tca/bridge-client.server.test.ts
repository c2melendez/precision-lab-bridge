// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTca1BridgeClient, Tca1BridgeError, type Tca1Fetch } from "./bridge-client.server";

const API_KEY = "plb_tca1_test_secret_not_for_output";
const config = {
  baseUrl: "https://bridge.example",
  apiKey: API_KEY,
  timeoutMs: 5_000,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetcher = vi.fn(async () => jsonResponse({ ok: true }));
});

describe("TCA-1 Bridge client", () => {
  it("injects the credential only as a server-side header and forbids redirects", async () => {
    const client = createTca1BridgeClient(config, { fetcher: fetcher as Tca1Fetch });
    await client.getCapabilities();
    const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    const headers = new Headers(init.headers);
    expect(String(url)).toBe("https://bridge.example/api/v1/capabilities");
    expect(headers.get("X-Bridge-Key")).toBe(API_KEY);
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("Accept")).toBe("application/json");
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    expect(String(url)).not.toContain(API_KEY);
  });

  it("calls only documented read endpoints and validates path parameters", async () => {
    const client = createTca1BridgeClient(config, { fetcher: fetcher as Tca1Fetch });
    await client.getContextStatus("lite");
    await client.getGatePlan("h1d", "plus");
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://bridge.example/api/v1/context/status?repo=lite");
    expect(String(fetcher.mock.calls[1]?.[0])).toBe("https://bridge.example/api/v1/context/gates/h1d/plan?repo=plus");
    expect(() => client.getGatePlan("../secret", "lite")).toThrow("TCA1_INVALID_GATE");
    expect(() => client.getContextStatus("both;key=secret" as never)).toThrow("TCA1_INVALID_REPOSITORY");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("sends the exact idempotency key in the header and body", async () => {
    const client = createTca1BridgeClient(config, { fetcher: fetcher as Tca1Fetch });
    const envelope = {
      schema_version: 1 as const,
      command_type: "repo.inspect" as const,
      target_repo: "lite" as const,
      expected_branch: "main",
      expected_sha: "a".repeat(40),
      payload: {},
      idempotency_key: "tca1-probe-001",
      correlation_id: "tca1-probe",
      validation_id: "tca1-v1",
    };
    await client.submitCommand(envelope);
    const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    const headers = new Headers(init.headers);
    expect(String(url)).toBe("https://bridge.example/api/v1/commands");
    expect(init.method).toBe("POST");
    expect(headers.get("Idempotency-Key")).toBe(envelope.idempotency_key);
    expect(JSON.parse(String(init.body))).toEqual(envelope);
  });

  it("rejects invalid command envelopes before making a network request", async () => {
    const client = createTca1BridgeClient(config, { fetcher: fetcher as Tca1Fetch });
    const invalid = {
      schema_version: 1,
      command_type: "shell.exec",
      target_repo: "lite",
      expected_branch: "main",
      expected_sha: "a".repeat(40),
      payload: {},
      idempotency_key: "tca1-probe-002",
      correlation_id: "tca1-probe",
      validation_id: "tca1-v1",
    };
    await expect(client.submitCommand(invalid as never)).rejects.toThrow("TCA1_INVALID_COMMAND_ENVELOPE");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("supports owner-scoped receipt reads and lookup without exposing the key in URLs", async () => {
    const client = createTca1BridgeClient(config, { fetcher: fetcher as Tca1Fetch });
    await client.getCommand("00000000-0000-4000-8000-000000000001");
    await client.lookupCommand("tca1-probe-003");
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://bridge.example/api/v1/commands/00000000-0000-4000-8000-000000000001");
    expect(String(fetcher.mock.calls[1]?.[0])).toBe("https://bridge.example/api/v1/commands/lookup");
    expect(new Headers((fetcher.mock.calls[1]?.[1] as RequestInit).headers).get("Idempotency-Key"))
      .toBe("tca1-probe-003");
  });

  it("redacts error response bodies and never includes the credential in errors", async () => {
    fetcher.mockResolvedValueOnce(jsonResponse({ error: "insufficient_scope", debug: API_KEY }, 403));
    const client = createTca1BridgeClient(config, { fetcher: fetcher as Tca1Fetch });
    try {
      await client.getCapabilities();
      throw new Error("expected request to fail");
    } catch (error) {
      expect(error).toMatchObject({ httpStatus: 403, code: "BRIDGE_HTTP_403" });
      expect(String(error)).not.toContain(API_KEY);
      expect(JSON.stringify(error)).not.toContain(API_KEY);
    }
  });

  it("rejects redirect responses without exposing Location, body, or credential", async () => {
    const redirectLocation = `https://untrusted.example/redirect?credential=${API_KEY}`;
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({
      error: "redirect_response",
      debug: API_KEY,
      location: redirectLocation,
    }), {
      status: 302,
      headers: {
        "content-type": "application/json",
        location: redirectLocation,
      },
    }));

    const client = createTca1BridgeClient(config, { fetcher: fetcher as Tca1Fetch });
    let observedError: unknown;
    try {
      await client.getCapabilities();
      throw new Error("expected redirect response to fail");
    } catch (error) {
      observedError = error;
    }

    expect(observedError).toMatchObject({
      httpStatus: 302,
      code: "BRIDGE_HTTP_302",
    });
    expect(String(observedError)).not.toContain(API_KEY);
    expect(String(observedError)).not.toContain("untrusted.example");
    expect(JSON.stringify(observedError)).not.toContain(API_KEY);
    expect(JSON.stringify(observedError)).not.toContain("untrusted.example");

    const [, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
  });

  it("fails closed on network errors without echoing request metadata", async () => {
    fetcher.mockRejectedValueOnce(new Error(`failed request with ${API_KEY}`));
    const client = createTca1BridgeClient(config, { fetcher: fetcher as Tca1Fetch });
    await expect(client.getCapabilities()).rejects.toMatchObject({
      httpStatus: 0,
      code: "BRIDGE_NETWORK_OR_TIMEOUT",
    });
    expect(() => createTca1BridgeClient({
      ...config, baseUrl: "http://bridge.example",
    })).toThrow("TCA1_UNSAFE_BASE_URL");
  });
});
