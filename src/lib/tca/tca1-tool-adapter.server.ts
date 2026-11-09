import { z } from "zod";
import type { CommandEnvelope } from "@/lib/bridge/commands";
import type { Tca1BridgeClient } from "./bridge-client.server";
import { createTca1BridgeClient } from "./bridge-client.server";
import { resolveTca1RuntimeConfig, type Tca1AccessMode } from "./tca1-policy";

export type Tca1ToolDefinition = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
};

const EMPTY = z.object({}).strict();
const STATUS = z.object({ repo: z.enum(["lite", "plus", "both"]).optional() }).strict();
const PLAN = z.object({
  gate: z.string().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/),
  repo: z.enum(["lite", "plus"]),
}).strict();
const COMMAND_ID = z.object({ command_id: z.string().uuid() }).strict();
const LOOKUP = z.object({ idempotency_key: z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/) }).strict();

const COMMAND_ENVELOPE = z.object({
  schema_version: z.literal(1),
  command_type: z.enum(["repo.inspect", "repo.patch", "repo.validate"]),
  target_repo: z.enum(["lite", "plus"]),
  expected_branch: z.string().min(1).max(255),
  expected_sha: z.string().regex(/^[a-f0-9]{40}$/i),
  payload: z.record(z.string(), z.unknown()),
  idempotency_key: z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/),
  correlation_id: z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/),
  validation_id: z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/),
}).strict();

const READ_TOOLS: Tca1ToolDefinition[] = [
  {
    name: "precision_lab_bridge_capabilities",
    description: "Read Bridge capabilities and scopes available to this consumer.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "precision_lab_bridge_context_status",
    description: "Read live Lite/Plus repository status through Bridge Observer proxy.",
    inputSchema: {
      type: "object",
      properties: { repo: { type: "string", enum: ["lite", "plus", "both"] } },
      additionalProperties: false,
    },
  },
  {
    name: "precision_lab_bridge_gate_plan",
    description: "Read a non-dispatching Observer plan for one gate and repository.",
    inputSchema: {
      type: "object",
      properties: {
        gate: { type: "string", minLength: 1, maxLength: 100, pattern: "^[A-Za-z0-9._-]+$" },
        repo: { type: "string", enum: ["lite", "plus"] },
      },
      required: ["gate", "repo"],
      additionalProperties: false,
    },
  },
];

const SUBMIT_TOOLS: Tca1ToolDefinition[] = [
  {
    name: "precision_lab_bridge_submit_command",
    description: "Submit one typed repo.inspect/repo.patch/repo.validate command. Bridge enforces scopes, SHA checks, idempotency and server policy.",
    inputSchema: {
      type: "object",
      properties: {
        schema_version: { type: "integer", const: 1 },
        command_type: { type: "string", enum: ["repo.inspect", "repo.patch", "repo.validate"] },
        target_repo: { type: "string", enum: ["lite", "plus"] },
        expected_branch: { type: "string", minLength: 1, maxLength: 255 },
        expected_sha: { type: "string", pattern: "^[a-fA-F0-9]{40}$" },
        payload: { type: "object" },
        idempotency_key: { type: "string", minLength: 1, maxLength: 200, pattern: "^[A-Za-z0-9._:-]+$" },
        correlation_id: { type: "string", minLength: 1, maxLength: 200 },
        validation_id: { type: "string", minLength: 1, maxLength: 200 },
      },
      required: ["schema_version", "command_type", "target_repo", "expected_branch", "expected_sha", "payload", "idempotency_key", "correlation_id", "validation_id"],
      additionalProperties: false,
    },
  },
  {
    name: "precision_lab_bridge_get_command",
    description: "Read a command receipt owned by the authenticated Bridge consumer.",
    inputSchema: {
      type: "object",
      properties: { command_id: { type: "string", format: "uuid" } },
      required: ["command_id"],
      additionalProperties: false,
    },
  },
  {
    name: "precision_lab_bridge_lookup_command",
    description: "Reconcile an ambiguous submission using the original idempotency key; never resubmits.",
    inputSchema: {
      type: "object",
      properties: { idempotency_key: { type: "string", minLength: 1, maxLength: 200 } },
      required: ["idempotency_key"],
      additionalProperties: false,
    },
  },
];

export type Tca1ToolAdapter = {
  accessMode: Tca1AccessMode;
  tools: Tca1ToolDefinition[];
  handlers: Record<string, (input: unknown) => Promise<Record<string, unknown>>>;
};

export function createTca1ToolAdapter(
  client: Tca1BridgeClient,
  accessMode: Tca1AccessMode,
): Tca1ToolAdapter {
  const handlers: Record<string, (input: unknown) => Promise<Record<string, unknown>>> = {
    precision_lab_bridge_capabilities: async (input) => {
      EMPTY.parse(input);
      return client.getCapabilities();
    },
    precision_lab_bridge_context_status: async (input) => {
      const parsed = STATUS.parse(input);
      return client.getContextStatus(parsed.repo ?? "both");
    },
    precision_lab_bridge_gate_plan: async (input) => {
      const parsed = PLAN.parse(input);
      return client.getGatePlan(parsed.gate, parsed.repo);
    },
  };

  if (accessMode === "submit") {
    handlers["precision_lab_bridge_submit_command"] = async (input) =>
      client.submitCommand(COMMAND_ENVELOPE.parse(input) as CommandEnvelope);
    handlers["precision_lab_bridge_get_command"] = async (input) => {
      const parsed = COMMAND_ID.parse(input);
      return client.getCommand(parsed.command_id);
    };
    handlers["precision_lab_bridge_lookup_command"] = async (input) => {
      const parsed = LOOKUP.parse(input);
      return client.lookupCommand(parsed.idempotency_key);
    };
  }

  return {
    accessMode,
    tools: accessMode === "submit" ? [...READ_TOOLS, ...SUBMIT_TOOLS] : [...READ_TOOLS],
    handlers,
  };
}

/**
 * Host-side entrypoint. TCA1_BRIDGE_KEY is read by this server module only;
 * it is never part of a tool definition or handler argument.
 */
export function createTca1ToolAdapterFromEnv(
  env: Record<string, string | undefined> = process.env,
  fetcher?: typeof fetch,
): Tca1ToolAdapter {
  const config = resolveTca1RuntimeConfig(env);
  const client = createTca1BridgeClient(config, fetcher ? { fetcher } : {});
  return createTca1ToolAdapter(client, config.accessMode);
}
