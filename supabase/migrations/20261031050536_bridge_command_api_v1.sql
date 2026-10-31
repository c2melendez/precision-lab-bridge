-- M1: generic, owner-scoped command intake. No Runner execution is enabled by this migration.
-- This migration broadens allowed scopes but deliberately does not update existing key rows.

CREATE OR REPLACE FUNCTION public.bridge_scope_array_unique(p_scopes text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
SET search_path = pg_catalog
AS $scope_unique$
  SELECT cardinality(p_scopes) = (
    SELECT count(DISTINCT scope)::integer
    FROM unnest(p_scopes) AS entries(scope)
  )
$scope_unique$;

REVOKE ALL ON FUNCTION public.bridge_scope_array_unique(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_scope_array_unique(text[]) TO service_role;

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.bridge_keys
    WHERE scopes IS NULL
      OR cardinality(scopes) NOT BETWEEN 1 AND 5
      OR scopes <@ ARRAY['read','dispatch','context:read','command:submit','command:read']::text[] IS NOT TRUE
      OR array_position(scopes, NULL) IS NOT NULL
      OR NOT public.bridge_scope_array_unique(scopes)
  ) THEN
    RAISE EXCEPTION 'bridge_keys contains scopes incompatible with the M1 scope contract';
  END IF;
END
$preflight$;

ALTER TABLE public.bridge_keys
  DROP CONSTRAINT IF EXISTS bridge_keys_scopes_valid;

ALTER TABLE public.bridge_keys
  ADD CONSTRAINT bridge_keys_scopes_valid
  CHECK (
    cardinality(scopes) BETWEEN 1 AND 5
    AND scopes <@ ARRAY['read','dispatch','context:read','command:submit','command:read']::text[]
    AND array_position(scopes, NULL) IS NULL
    AND public.bridge_scope_array_unique(scopes)
  );

COMMENT ON COLUMN public.bridge_keys.scopes IS
  'Explicit least-privilege scopes. Existing rows are preserved; context:read, command:submit and command:read are opt-in for newly issued or explicitly updated keys.';

CREATE TABLE public.bridge_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id uuid NOT NULL REFERENCES public.bridge_keys(id),
  idempotency_key text NOT NULL,
  command_type text NOT NULL,
  target_repo text NOT NULL,
  expected_branch text NOT NULL,
  expected_sha text NOT NULL,
  request_fingerprint text NOT NULL,
  request_payload jsonb NOT NULL,
  observer_context jsonb NOT NULL,
  correlation_id text NOT NULL,
  validation_id text NOT NULL,
  status text NOT NULL DEFAULT 'accepted',
  response jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  replay_count integer NOT NULL DEFAULT 0,
  attempt_count integer NOT NULL DEFAULT 0,
  lease_token uuid,
  lease_expires_at timestamptz,
  actions_run_id text,
  runner_record jsonb,
  commit_sha text,
  pull_request_number integer,
  pull_request_url text,
  CONSTRAINT bridge_commands_key_idempotency_unique UNIQUE (key_id, idempotency_key),
  CONSTRAINT bridge_commands_idempotency_key_length CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  CONSTRAINT bridge_commands_type_check CHECK (command_type IN ('repo.inspect','repo.patch','repo.validate')),
  CONSTRAINT bridge_commands_target_check CHECK (target_repo IN ('lite','plus')),
  CONSTRAINT bridge_commands_branch_check CHECK (
    length(expected_branch) BETWEEN 1 AND 255
    AND expected_branch ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$'
    AND expected_branch !~ '\.\.'
    AND expected_branch !~ '//'
    AND expected_branch !~ '/$'
  ),
  CONSTRAINT bridge_commands_sha_check CHECK (expected_sha ~ '^[0-9a-f]{40}$'),
  CONSTRAINT bridge_commands_fingerprint_check CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT bridge_commands_payload_check CHECK (
    jsonb_typeof(request_payload) = 'object'
    AND octet_length(request_payload::text) <= 262144
  ),
  CONSTRAINT bridge_commands_observer_context_check CHECK (
    jsonb_typeof(observer_context) = 'object'
    AND octet_length(observer_context::text) <= 32768
  ),
  CONSTRAINT bridge_commands_correlation_check CHECK (correlation_id ~ '^[A-Za-z0-9._:-]{1,200}$'),
  CONSTRAINT bridge_commands_validation_check CHECK (validation_id ~ '^[A-Za-z0-9._:-]{1,200}$'),
  CONSTRAINT bridge_commands_status_check CHECK (
    status IN ('accepted','queued','validating','running','awaiting_review','completed','failed','blocked','reconcile_required')
  ),
  CONSTRAINT bridge_commands_counts_check CHECK (replay_count >= 0 AND attempt_count >= 0),
  CONSTRAINT bridge_commands_lease_check CHECK (
    (lease_token IS NULL AND lease_expires_at IS NULL)
    OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  ),
  CONSTRAINT bridge_commands_completed_check CHECK (
    status NOT IN ('completed','failed','blocked','reconcile_required') OR completed_at IS NOT NULL
  ),
  CONSTRAINT bridge_commands_commit_sha_check CHECK (commit_sha IS NULL OR commit_sha ~ '^[0-9a-f]{40}$')
);

CREATE INDEX bridge_commands_owner_created_idx
  ON public.bridge_commands(key_id, created_at DESC);

CREATE INDEX bridge_commands_status_created_idx
  ON public.bridge_commands(status, created_at DESC);

ALTER TABLE public.bridge_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bridge_commands FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bridge_commands TO service_role;

CREATE OR REPLACE FUNCTION public.bridge_submit_command(
  p_key_id uuid,
  p_idempotency_key text,
  p_command_type text,
  p_target_repo text,
  p_expected_branch text,
  p_expected_sha text,
  p_fingerprint text,
  p_payload jsonb,
  p_observer_context jsonb,
  p_correlation_id text,
  p_validation_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $bridge_submit_command$
DECLARE
  credential_scopes text[];
  command_row public.bridge_commands;
BEGIN
  SELECT scopes INTO credential_scopes
  FROM public.bridge_keys
  WHERE id = p_key_id
    AND revoked_at IS NULL
    AND expires_at > clock_timestamp()
  FOR SHARE;

  IF NOT FOUND OR credential_scopes @> ARRAY['command:submit']::text[] IS NOT TRUE THEN
    RAISE EXCEPTION 'BRIDGE_COMMAND_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;

  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{1,200}$'
    OR p_command_type IS NULL OR p_command_type NOT IN ('repo.inspect','repo.patch','repo.validate')
    OR p_target_repo IS NULL OR p_target_repo NOT IN ('lite','plus')
    OR p_expected_branch IS NULL OR length(p_expected_branch) NOT BETWEEN 1 AND 255
    OR p_expected_branch !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$'
    OR p_expected_branch ~ '\.\.' OR p_expected_branch ~ '//' OR p_expected_branch ~ '/$'
    OR p_expected_sha IS NULL OR p_expected_sha !~ '^[0-9a-f]{40}$'
    OR p_fingerprint IS NULL OR p_fingerprint !~ '^[0-9a-f]{64}$'
    OR p_payload IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
    OR octet_length(p_payload::text) > 262144
    OR p_observer_context IS NULL OR jsonb_typeof(p_observer_context) IS DISTINCT FROM 'object'
    OR octet_length(p_observer_context::text) > 32768
    OR p_correlation_id IS NULL OR p_correlation_id !~ '^[A-Za-z0-9._:-]{1,200}$'
    OR p_validation_id IS NULL OR p_validation_id !~ '^[A-Za-z0-9._:-]{1,200}$'
  THEN
    RAISE EXCEPTION 'BRIDGE_COMMAND_INVALID' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.bridge_commands (
    key_id, idempotency_key, command_type, target_repo, expected_branch, expected_sha,
    request_fingerprint, request_payload, observer_context, correlation_id, validation_id, status
  ) VALUES (
    p_key_id, p_idempotency_key, p_command_type, p_target_repo, p_expected_branch, p_expected_sha,
    p_fingerprint, p_payload, p_observer_context, p_correlation_id, p_validation_id, 'accepted'
  )
  ON CONFLICT (key_id, idempotency_key) DO NOTHING
  RETURNING * INTO command_row;

  IF FOUND THEN
    UPDATE public.bridge_commands
    SET response = jsonb_build_object(
      'command_id', command_row.id,
      'command_type', command_row.command_type,
      'target_repo', command_row.target_repo,
      'expected_branch', command_row.expected_branch,
      'expected_sha', command_row.expected_sha,
      'status', command_row.status,
      'correlation_id', command_row.correlation_id,
      'validation_id', command_row.validation_id,
      'created_at', to_jsonb(command_row.created_at),
      'updated_at', to_jsonb(command_row.updated_at),
      'replay_count', 0,
      'execution_enabled', false
    )
    WHERE id = command_row.id
    RETURNING * INTO command_row;
    RETURN jsonb_build_object('action','accepted','record',to_jsonb(command_row));
  END IF;

  SELECT * INTO command_row
  FROM public.bridge_commands
  WHERE key_id = p_key_id AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BRIDGE_COMMAND_CLAIM_NOT_FOUND';
  END IF;

  IF command_row.request_fingerprint <> p_fingerprint THEN
    RETURN jsonb_build_object('action','conflict');
  END IF;

  UPDATE public.bridge_commands
  SET replay_count = replay_count + 1,
      updated_at = clock_timestamp()
  WHERE id = command_row.id
  RETURNING * INTO command_row;

  RETURN jsonb_build_object('action','replay','record',to_jsonb(command_row));
END
$bridge_submit_command$;

REVOKE ALL ON FUNCTION public.bridge_submit_command(uuid,text,text,text,text,text,text,jsonb,jsonb,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_submit_command(uuid,text,text,text,text,text,text,jsonb,jsonb,text,text)
  TO service_role;
