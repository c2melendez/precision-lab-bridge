import { timingSafeEqual } from "node:crypto";
import { z, ZodError } from "zod";
import { Tca1BridgeError } from "./bridge-client.server";
import {
  createTca1ToolAdapterFromEnv,
  type Tca1ToolAdapter,
} from "./tca1-tool-adapter.server";

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESULT_BYTES = 96 * 1024;
const functionCallSchema = z.object({
  name: z.string().min(1).max(100),
  arguments: z.record(z.string(), z.unknown()),
}).strict();

type Environment = Record<string, string | undefined>;
type AdapterFactory = (env: Environment) => Tca1ToolAdapter;
export type Tca1FunctionGatewayDependencies = {
  env?: Environment;
  createAdapter?: AdapterFactory;
};
type BoundedText =
  | { ok: true; text: string }
  | { ok: false; reason: "too_large" | "invalid_utf8" };

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store, max-age=0",
      pragma: "no-cache",
      vary: "Authorization",
    },
  });
}

function isConfiguredGatewayToken(value: string | undefined): value is string {
  return value !== undefined && value === value.trim() &&
    value.length >= 32 && value.length <= 256;
}

function isAuthorized(request: Request, expected: string): boolean {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7), "utf8");
  const configured = Buffer.from(expected, "utf8");
  return supplied.length === configured.length && timingSafeEqual(supplied, configured);
}

async function readBoundedText(request: Request): Promise<BoundedText> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) &&
    Number(contentLength) > MAX_REQUEST_BYTES) {
    return { ok: false, reason: "too_large" };
  }
  if (!request.body) return { ok: true, text: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, reason: "invalid_utf8" };
  }
}

function createAdapter(env: Environment, factory: AdapterFactory): Tca1ToolAdapter | null {
  try {
    return factory(env);
  } catch {
    // Never reveal environment values or configuration exception details.
    return null;
  }
}

/**
 * Server-side Function Calling gateway.
 * TCA1_FUNCTION_GATEWAY_TOKEN authenticates the host/orchestrator.
 * TCA1_BRIDGE_KEY is read only by createTca1ToolAdapterFromEnv() and is
 * injected into Bridge requests as X-Bridge-Key; it is never returned here.
 */
export async function handleTca1FunctionGatewayRequest(
  request: Request,
  dependencies: Tca1FunctionGatewayDependencies = {},
): Promise<Response> {
  const env = dependencies.env ?? process.env;
  const expectedToken = env["TCA1_FUNCTION_GATEWAY_TOKEN"];
  if (!isConfiguredGatewayToken(expectedToken)) {
    return json({ error: "TCA1_FUNCTION_GATEWAY_NOT_CONFIGURED" }, 503);
  }
  if (!isAuthorized(request, expectedToken)) {
    return json({ error: "UNAUTHORIZED" }, 401);
  }

  const url = new URL(request.url);
  if (url.search) return json({ error: "QUERY_PARAMETERS_NOT_SUPPORTED" }, 400);
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { allow: "GET, POST", "cache-control": "no-store", vary: "Authorization" },
    });
  }

  const adapter = createAdapter(
    env,
    dependencies.createAdapter ?? createTca1ToolAdapterFromEnv,
  );
  if (!adapter) return json({ error: "TCA1_ADAPTER_NOT_CONFIGURED" }, 503);

  if (request.method === "GET") {
    return json({
      access_mode: adapter.accessMode,
      tools: adapter.tools.map((tool) => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      })),
    });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return json({ error: "CONTENT_TYPE_MUST_BE_JSON" }, 415);
  }
  const body = await readBoundedText(request);
  if (!body.ok) {
    return json({
      error: body.reason === "too_large" ? "REQUEST_TOO_LARGE" : "INVALID_UTF8",
    }, body.reason === "too_large" ? 413 : 400);
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(body.text) as unknown;
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }
  const parsed = functionCallSchema.safeParse(parsedBody);
  if (!parsed.success) return json({ error: "INVALID_FUNCTION_CALL_ENVELOPE" }, 400);

  const toolIsExposed = adapter.tools.some((tool) => tool.name === parsed.data.name);
  const handler = adapter.handlers[parsed.data.name];
  if (!toolIsExposed || !handler) return json({ error: "TOOL_NOT_AVAILABLE" }, 403);

  try {
    const result = await handler(parsed.data.arguments);
    let serialized: string;
    try {
      serialized = JSON.stringify(result);
    } catch {
      return json({ ok: false, error: "TOOL_RESULT_NOT_SERIALIZABLE" });
    }
    if (Buffer.byteLength(serialized, "utf8") > MAX_RESULT_BYTES) {
      return json({ ok: false, error: "TOOL_RESULT_TOO_LARGE" });
    }
    return json({ ok: true, result });
  } catch (error) {
    if (error instanceof Tca1BridgeError) {
      return json({ ok: false, error: error.code });
    }
    if (error instanceof ZodError) {
      return json({ ok: false, error: "INVALID_TOOL_ARGUMENTS" });
    }
    return json({ ok: false, error: "TCA1_TOOL_EXECUTION_FAILED" });
  }
}
