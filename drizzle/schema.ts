import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const bridgeKeys = pgTable("bridge_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  label: text("label").notNull(),
  key_hash: text("key_hash").notNull(),
  key_prefix: text("key_prefix").notNull(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  expires_at: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  revoked_at: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
  last_used_at: timestamp("last_used_at", { withTimezone: true, mode: "string" }),
  scopes: text("scopes").array().notNull().default(sql`ARRAY['read']::text[]`),
}, (t) => ({
  keyHashUnique: unique("bridge_keys_key_hash_key").on(t.key_hash),
  scopesValid: check("bridge_keys_scopes_valid", sql.raw("cardinality(scopes) BETWEEN 1 AND 5 AND scopes <@ ARRAY['read','dispatch','context:read','command:submit','command:read']::text[] AND array_position(scopes,NULL) IS NULL AND public.bridge_scope_array_unique(scopes)")),
}));

export const bridgeRuns = pgTable("bridge_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  target_repo: text("target_repo").notNull(),
  gate: text("gate").notNull(),
  dry_run: boolean("dry_run").notNull(),
  dispatched_at: timestamp("dispatched_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  gh_runs: jsonb("gh_runs").notNull().default(sql`'[]'::jsonb`),
  key_id: uuid("key_id").notNull(),
}, (t) => ({
  keyOwnerFk: foreignKey({ name: "bridge_runs_key_id_fkey", columns: [t.key_id], foreignColumns: [bridgeKeys.id] }),
  keyOwnerIdx: index("bridge_runs_key_id_idx").on(t.key_id),
  dedupeIdx: index("bridge_runs_dedupe_idx").on(t.target_repo, t.gate, t.dry_run, t.dispatched_at.desc()),
}));

export const bridgeCalls = pgTable("bridge_calls", {
  id: uuid("id").defaultRandom().primaryKey(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  endpoint: text("endpoint").notNull(),
  key_prefix: text("key_prefix"),
  params: jsonb("params").notNull().default(sql`'{}'::jsonb`),
  http_status: integer("http_status").notNull(),
  result: jsonb("result").notNull().default(sql`'{}'::jsonb`),
}, (t) => ({ createdIdx: index("bridge_calls_created_idx").on(t.created_at.desc()) }));

export const bridgeIdempotency = pgTable("bridge_idempotency", {
  id: uuid("id").defaultRandom().primaryKey(),
  idempotency_key: text("idempotency_key").notNull(),
  key_id: uuid("key_id").notNull(),
  validation_id: text("validation_id").notNull(),
  correlation_id: text("correlation_id").notNull(),
  repo: text("repo").notNull(),
  branch: text("branch").notNull(),
  requested_sha: text("requested_sha"),
  request_fingerprint: text("request_fingerprint").notNull(),
  request_payload: jsonb("request_payload").notNull(),
  state: text("state").notNull().default("RUNNING"),
  outcome_state: text("outcome_state"),
  response: jsonb("response"),
  http_status: integer("http_status"),
  error_code: text("error_code"),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  started_at: timestamp("started_at", { withTimezone: true, mode: "string" }),
  finished_at: timestamp("finished_at", { withTimezone: true, mode: "string" }),
  lease_token: uuid("lease_token"),
  lease_expires_at: timestamp("lease_expires_at", { withTimezone: true, mode: "string" }),
  attempt_count: integer("attempt_count").notNull().default(1),
  replay_count: integer("replay_count").notNull().default(0),
  run_id: uuid("run_id"),
  gh_runs: jsonb("gh_runs").notNull().default(sql`'[]'::jsonb`),
  job_ids: jsonb("job_ids").notNull().default(sql`'[]'::jsonb`),
  dispatch_intents: jsonb("dispatch_intents").notNull().default(sql`'{}'::jsonb`),
  workflow_result: jsonb("workflow_result"),
}, (t) => ({
  keyOwnerFk: foreignKey({ name: "bridge_idempotency_key_id_fkey", columns: [t.key_id], foreignColumns: [bridgeKeys.id] }),
  runFk: foreignKey({ name: "bridge_idempotency_run_id_fkey", columns: [t.run_id], foreignColumns: [bridgeRuns.id] }),
  scopedIdempotency: unique("bridge_idempotency_key_scope_unique").on(t.key_id, t.idempotency_key),
  keyOwnerIdx: index("bridge_idempotency_key_id_idx").on(t.key_id),
  runIdx: index("bridge_idempotency_run_idx").on(t.run_id),
  leaseIdx: index("bridge_idempotency_lease_idx").on(t.lease_expires_at).where(sql`${t.state}='RUNNING'`),
  keyLength: check("bridge_idempotency_key_length", sql`length(${t.idempotency_key}) BETWEEN 1 AND 200`),
  fingerprintValid: check("bridge_idempotency_fingerprint", sql`${t.request_fingerprint} ~ '^[0-9a-f]{64}$'`),
  stateValid: check("bridge_idempotency_state_check", sql`${t.state} IN ('BLOCKED','FAILED','RUNNING','SUCCEEDED','REPLAYED')`),
  outcomeValid: check("bridge_idempotency_outcome_state_check", sql`${t.outcome_state} IS NULL OR ${t.outcome_state} IN ('BLOCKED','FAILED','RUNNING','SUCCEEDED')`),
  lifecycleValid: check("bridge_idempotency_lifecycle", sql`(
    (${t.response} IS NULL AND ${t.http_status} IS NULL AND ${t.state}='RUNNING'
      AND ${t.outcome_state} IS NULL AND ${t.lease_token} IS NOT NULL
      AND ${t.lease_expires_at} IS NOT NULL AND ${t.finished_at} IS NULL)
    OR
    (${t.response} IS NOT NULL AND ${t.http_status} BETWEEN 100 AND 599
      AND ${t.lease_token} IS NULL AND ${t.lease_expires_at} IS NULL
      AND ((${t.state}='RUNNING' AND ${t.outcome_state}='RUNNING' AND ${t.finished_at} IS NULL)
        OR (${t.state} IN ('BLOCKED','FAILED','SUCCEEDED') AND ${t.outcome_state}=${t.state} AND ${t.finished_at} IS NOT NULL)
        OR (${t.state}='REPLAYED' AND ${t.outcome_state}='SUCCEEDED' AND ${t.finished_at} IS NOT NULL))
    )
  )`),
}));

export const bridgeCommands = pgTable("bridge_commands", {
  id: uuid("id").defaultRandom().primaryKey(),
  key_id: uuid("key_id").notNull(),
  idempotency_key: text("idempotency_key").notNull(),
  command_type: text("command_type").notNull(),
  target_repo: text("target_repo").notNull(),
  expected_branch: text("expected_branch").notNull(),
  expected_sha: text("expected_sha").notNull(),
  request_fingerprint: text("request_fingerprint").notNull(),
  request_payload: jsonb("request_payload").notNull(),
  observer_context: jsonb("observer_context").notNull(),
  correlation_id: text("correlation_id").notNull(),
  validation_id: text("validation_id").notNull(),
  status: text("status").notNull().default("accepted"),
  response: jsonb("response"),
  error_code: text("error_code"),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  completed_at: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  replay_count: integer("replay_count").notNull().default(0),
  attempt_count: integer("attempt_count").notNull().default(0),
  lease_token: uuid("lease_token"),
  lease_expires_at: timestamp("lease_expires_at", { withTimezone: true, mode: "string" }),
  actions_run_id: text("actions_run_id"),
  runner_record: jsonb("runner_record"),
  commit_sha: text("commit_sha"),
  pull_request_number: integer("pull_request_number"),
  pull_request_url: text("pull_request_url"),
}, (t) => ({
  keyOwnerFk: foreignKey({ name: "bridge_commands_key_id_fkey", columns: [t.key_id], foreignColumns: [bridgeKeys.id] }),
  scopedIdempotency: unique("bridge_commands_key_idempotency_unique").on(t.key_id, t.idempotency_key),
  ownerCreatedIdx: index("bridge_commands_owner_created_idx").on(t.key_id, t.created_at.desc()),
  statusCreatedIdx: index("bridge_commands_status_created_idx").on(t.status, t.created_at.desc()),
  keyLength: check("bridge_commands_idempotency_key_length", sql.raw("length(idempotency_key) BETWEEN 1 AND 200")),
  fingerprintValid: check("bridge_commands_fingerprint_check", sql.raw("request_fingerprint ~ '^[0-9a-f]{64}$'")),
  statusValid: check("bridge_commands_status_check", sql.raw("status IN ('accepted','queued','validating','running','awaiting_review','completed','failed','blocked','reconcile_required')")),
}));
