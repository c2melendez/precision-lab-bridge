import { z } from "zod";

export const TCA1_MIN_TTL_MINUTES = 5;
export const TCA1_MAX_TTL_MINUTES = 24 * 60;
export const TCA1_DEFAULT_TTL_MINUTES = 60;

export const TCA1_ACCESS_MODES = ["read", "submit"] as const;
export type Tca1AccessMode = (typeof TCA1_ACCESS_MODES)[number];

const tca1Label = z.string()
  .trim()
  .min(6)
  .max(64)
  .regex(/^tca1-[a-z0-9][a-z0-9._-]{0,58}$/i, "label must start with tca1- and contain a consumer identifier");

export const createTca1KeyInputSchema = z.object({
  password: z.string().min(1).max(200),
  label: tca1Label,
  ttlMinutes: z.number().int().min(TCA1_MIN_TTL_MINUTES).max(TCA1_MAX_TTL_MINUTES),
  accessMode: z.enum(TCA1_ACCESS_MODES),
}).strict();

export type CreateTca1KeyInput = z.infer<typeof createTca1KeyInputSchema>;

export function scopesForTca1AccessMode(accessMode: Tca1AccessMode): string[] {
  if (accessMode === "read") return ["context:read"];
  return ["context:read", "command:submit", "command:read"];
}

export function tca1ExpiryIso(ttlMinutes: number, nowMs = Date.now()): string {
  if (!Number.isSafeInteger(ttlMinutes) ||
    ttlMinutes < TCA1_MIN_TTL_MINUTES ||
    ttlMinutes > TCA1_MAX_TTL_MINUTES) {
    throw new Error("TCA1_TTL_OUT_OF_RANGE");
  }
  if (!Number.isFinite(nowMs)) throw new Error("TCA1_INVALID_CLOCK");
  return new Date(nowMs + ttlMinutes * 60_000).toISOString();
}

export class Tca1ConfigurationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "Tca1ConfigurationError";
  }
}

export type Tca1RuntimeConfig = {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  accessMode: Tca1AccessMode;
};

export function parseTca1BridgeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Tca1ConfigurationError("TCA1_INVALID_BASE_URL");
  }
  const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && localHost)) ||
    url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Tca1ConfigurationError("TCA1_UNSAFE_BASE_URL");
  }
  return url.origin;
}

export function resolveTca1RuntimeConfig(
  env: Record<string, string | undefined>,
): Tca1RuntimeConfig {
  const baseUrlRaw = env["TCA1_BRIDGE_BASE_URL"];
  const apiKey = env["TCA1_BRIDGE_KEY"];
  if (!baseUrlRaw) throw new Tca1ConfigurationError("TCA1_BRIDGE_BASE_URL_MISSING");
  if (!apiKey || apiKey.trim() !== apiKey || apiKey.length < 16 || apiKey.length > 200) {
    throw new Tca1ConfigurationError("TCA1_BRIDGE_KEY_MISSING_OR_INVALID");
  }

  const timeoutRaw = env["TCA1_HTTP_TIMEOUT_MS"];
  const timeoutMs = timeoutRaw === undefined ? 10_000 : Number(timeoutRaw);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
    throw new Tca1ConfigurationError("TCA1_HTTP_TIMEOUT_OUT_OF_RANGE");
  }

  const modeRaw = env["TCA1_ACCESS_MODE"] ?? "read";
  if (modeRaw !== "read" && modeRaw !== "submit") {
    throw new Tca1ConfigurationError("TCA1_ACCESS_MODE_INVALID");
  }

  return {
    baseUrl: parseTca1BridgeBaseUrl(baseUrlRaw),
    apiKey,
    timeoutMs,
    accessMode: modeRaw,
  };
}
