-- M2: authenticated Runner dispatch, short-lived command leases and terminal callback.
-- Execution is feature-flagged off until the Bridge service is deployed and configured.

ALTER TABLE public.bridge_commands
  ADD COLUMN dispatch_intent_at timestamptz,
  ADD COLUMN dispatch_attempt_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.bridge_commands
  ADD CONSTRAINT bridge_commands_dispatch_attempt_count_check
  CHECK (dispatch_attempt_count >= 0);

CREATE OR REPLACE FUNCTION public.bridge_command_begin_dispatch(
  p_command_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $bridge_command_begin_dispatch$
DECLARE
  command_row public.bridge_commands;
BEGIN
  SELECT * INTO command_row
  FROM public.bridge_commands
  WHERE id = p_command_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BRIDGE_COMMAND_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF command_row.status = 'accepted' THEN
    UPDATE public.bridge_commands
    SET status = 'validating',
        dispatch_intent_at = clock_timestamp(),
        dispatch_attempt_count = dispatch_attempt_count + 1,
        runner_record = coalesce(runner_record,'{}'::jsonb) || jsonb_build_object(
          'dispatch_intent_at',clock_timestamp(),
          'dispatch_intent','created'
        ),
        updated_at = clock_timestamp()
    WHERE id = p_command_id
    RETURNING * INTO command_row;
    RETURN jsonb_build_object('action','started','record',to_jsonb(command_row));
  END IF;

  IF command_row.status = 'validating'
    AND command_row.dispatch_intent_at IS NOT NULL
    AND command_row.dispatch_attempt_count = 1 THEN
    RETURN jsonb_build_object('action','replay','record',to_jsonb(command_row));
  END IF;

  RETURN jsonb_build_object('action','replay','record',to_jsonb(command_row));
END
$bridge_command_begin_dispatch$;

CREATE OR REPLACE FUNCTION public.bridge_command_record_dispatch(
  p_command_id uuid,
  p_outcome text,
  p_actions_run_id text,
  p_actions_run_url text,
  p_error_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $bridge_command_record_dispatch$
DECLARE
  command_row public.bridge_commands;
  expected_repo text;
BEGIN
  IF p_outcome NOT IN ('queued','blocked','reconcile_required') THEN
    RAISE EXCEPTION 'BRIDGE_COMMAND_DISPATCH_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO command_row
  FROM public.bridge_commands
  WHERE id = p_command_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BRIDGE_COMMAND_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  expected_repo := CASE command_row.target_repo
    WHEN 'lite' THEN 'c2melendez/precision-lab-lite'
    ELSE 'c2melendez/precision-lab-plus'
  END;

  IF p_outcome = 'queued' THEN
    IF p_actions_run_id IS NULL OR p_actions_run_id !~ '^[1-9][0-9]{0,19}$'
      OR p_actions_run_url IS DISTINCT FROM
        ('https://github.com/' || expected_repo || '/actions/runs/' || p_actions_run_id)
      OR p_error_code IS NOT NULL THEN
      RAISE EXCEPTION 'BRIDGE_COMMAND_DISPATCH_INVALID' USING ERRCODE = '22023';
    END IF;
  ELSIF p_error_code IS NULL OR p_error_code !~ '^[A-Z0-9_]{3,100}$'
    OR p_actions_run_id IS NOT NULL OR p_actions_run_url IS NOT NULL THEN
    RAISE EXCEPTION 'BRIDGE_COMMAND_DISPATCH_INVALID' USING ERRCODE = '22023';
  END IF;

  IF command_row.status <> 'validating' THEN
    IF command_row.status = p_outcome
      AND command_row.actions_run_id IS NOT DISTINCT FROM p_actions_run_id
      AND command_row.runner_record->>'dispatch_run_url' IS NOT DISTINCT FROM p_actions_run_url
      AND command_row.error_code IS NOT DISTINCT FROM p_error_code THEN
      RETURN jsonb_build_object('action','replay','record',to_jsonb(command_row));
    END IF;
    RAISE EXCEPTION 'BRIDGE_COMMAND_DISPATCH_CONFLICT' USING ERRCODE = '40001';
  END IF;

  UPDATE public.bridge_commands
  SET status = p_outcome,
      actions_run_id = p_actions_run_id,
      error_code = p_error_code,
      runner_record = jsonb_build_object(
        'dispatch_run_url', p_actions_run_url,
        'dispatch_recorded_at', clock_timestamp(),
        'execution_plane', 'github_actions'
      ),
      response = coalesce(response,'{}'::jsonb) ||
        jsonb_strip_nulls(jsonb_build_object(
          'status',p_outcome,
          'dispatch_outcome',p_outcome,
          'actions_run_id',p_actions_run_id,
          'error_code',p_error_code,
          'execution_enabled',true
        )),
      completed_at = CASE WHEN p_outcome IN ('blocked','reconcile_required') THEN clock_timestamp() ELSE NULL END,
      updated_at = clock_timestamp()
  WHERE id = p_command_id
  RETURNING * INTO command_row;

  RETURN jsonb_build_object('action','recorded','record',to_jsonb(command_row));
END
$bridge_command_record_dispatch$;

CREATE OR REPLACE FUNCTION public.bridge_command_claim_runner(
  p_command_id uuid,
  p_runner_repository text,
  p_run_id text,
  p_run_attempt integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $bridge_command_claim_runner$
DECLARE
  command_row public.bridge_commands;
  expected_repo text;
  new_lease_token uuid;
  prior_run_attempt integer;
BEGIN
  IF p_runner_repository NOT IN ('c2melendez/precision-lab-lite','c2melendez/precision-lab-plus')
    OR p_run_id IS NULL OR p_run_id !~ '^[1-9][0-9]{0,19}$'
    OR p_run_attempt IS NULL OR p_run_attempt NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'BRIDGE_RUNNER_IDENTITY_INVALID' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO command_row
  FROM public.bridge_commands
  WHERE id = p_command_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BRIDGE_COMMAND_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  expected_repo := CASE command_row.target_repo
    WHEN 'lite' THEN 'c2melendez/precision-lab-lite'
    ELSE 'c2melendez/precision-lab-plus'
  END;

  IF p_runner_repository IS DISTINCT FROM expected_repo
    OR command_row.actions_run_id IS DISTINCT FROM p_run_id THEN
    RAISE EXCEPTION 'BRIDGE_RUNNER_COMMAND_MISMATCH' USING ERRCODE = '42501';
  END IF;

  prior_run_attempt := CASE
    WHEN command_row.runner_record->>'runner_run_attempt' ~ '^[1-9][0-9]*$'
    THEN (command_row.runner_record->>'runner_run_attempt')::integer
    ELSE 0
  END;

  IF command_row.status = 'running'
    AND command_row.lease_expires_at > clock_timestamp()
    AND prior_run_attempt = p_run_attempt
    AND command_row.lease_token IS NOT NULL THEN
    RETURN jsonb_build_object(
      'action','replay',
      'lease_token',command_row.lease_token,
      'manifest',jsonb_build_object(
        'command_id',command_row.id,
        'command_type',command_row.command_type,
        'target_repo',command_row.target_repo,
        'repository_full_name',expected_repo,
        'expected_branch',command_row.expected_branch,
        'expected_sha',command_row.expected_sha,
        'request_fingerprint',command_row.request_fingerprint,
        'payload',command_row.request_payload,
        'correlation_id',command_row.correlation_id,
        'validation_id',command_row.validation_id,
        'actions_run_id',command_row.actions_run_id,
        'lease_expires_at',command_row.lease_expires_at
      )
    );
  END IF;

  IF command_row.status <> 'queued'
    AND NOT (
      command_row.status = 'running'
      AND p_run_attempt > prior_run_attempt
      AND command_row.attempt_count < 3
    ) THEN
    RAISE EXCEPTION 'BRIDGE_COMMAND_NOT_CLAIMABLE' USING ERRCODE = '55000';
  END IF;

  IF command_row.attempt_count >= 3 THEN
    RAISE EXCEPTION 'BRIDGE_COMMAND_ATTEMPTS_EXHAUSTED' USING ERRCODE = '55000';
  END IF;

  new_lease_token := gen_random_uuid();

  UPDATE public.bridge_commands
  SET status = 'running',
      lease_token = new_lease_token,
      lease_expires_at = clock_timestamp() + interval '60 minutes',
      attempt_count = attempt_count + 1,
      runner_record = coalesce(runner_record,'{}'::jsonb) || jsonb_build_object(
        'runner_repository',p_runner_repository,
        'runner_run_id',p_run_id,
        'runner_run_attempt',p_run_attempt,
        'claimed_at',clock_timestamp()
      ),
      updated_at = clock_timestamp()
  WHERE id = p_command_id
  RETURNING * INTO command_row;

  RETURN jsonb_build_object(
    'action','claimed',
    'lease_token',new_lease_token,
    'manifest',jsonb_build_object(
      'command_id',command_row.id,
      'command_type',command_row.command_type,
      'target_repo',command_row.target_repo,
      'repository_full_name',expected_repo,
      'expected_branch',command_row.expected_branch,
      'expected_sha',command_row.expected_sha,
      'request_fingerprint',command_row.request_fingerprint,
      'payload',command_row.request_payload,
      'correlation_id',command_row.correlation_id,
      'validation_id',command_row.validation_id,
      'actions_run_id',command_row.actions_run_id,
      'lease_expires_at',command_row.lease_expires_at
    )
  );
END
$bridge_command_claim_runner$;

CREATE OR REPLACE FUNCTION public.bridge_command_finish_runner(
  p_command_id uuid,
  p_runner_repository text,
  p_run_id text,
  p_lease_token uuid,
  p_lease_token_hash text,
  p_final_status text,
  p_error_code text,
  p_result jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $bridge_command_finish_runner$
DECLARE
  command_row public.bridge_commands;
  expected_repo text;
  final_commit_sha text;
  final_pr_number integer;
  final_pr_url text;
BEGIN
  IF p_runner_repository NOT IN ('c2melendez/precision-lab-lite','c2melendez/precision-lab-plus')
    OR p_run_id IS NULL OR p_run_id !~ '^[1-9][0-9]{0,19}$'
    OR p_lease_token IS NULL
    OR p_lease_token_hash IS NULL OR p_lease_token_hash !~ '^[0-9a-f]{64}$'
    OR p_final_status NOT IN ('completed','awaiting_review','failed','blocked','reconcile_required')
    OR p_result IS NULL OR jsonb_typeof(p_result) IS DISTINCT FROM 'object'
    OR octet_length(p_result::text) > 32768 THEN
    RAISE EXCEPTION 'BRIDGE_RUNNER_RESULT_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO command_row
  FROM public.bridge_commands
  WHERE id = p_command_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BRIDGE_COMMAND_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  expected_repo := CASE command_row.target_repo
    WHEN 'lite' THEN 'c2melendez/precision-lab-lite'
    ELSE 'c2melendez/precision-lab-plus'
  END;

  IF p_runner_repository IS DISTINCT FROM expected_repo
    OR command_row.actions_run_id IS DISTINCT FROM p_run_id THEN
    RAISE EXCEPTION 'BRIDGE_RUNNER_COMMAND_MISMATCH' USING ERRCODE = '42501';
  END IF;

  IF command_row.status IN ('completed','awaiting_review','failed','blocked','reconcile_required')
    AND command_row.runner_record->>'lease_token_sha256' = p_lease_token_hash THEN
    RETURN jsonb_build_object('action','replay','record',to_jsonb(command_row));
  END IF;

  IF command_row.status <> 'running'
    OR command_row.lease_token IS DISTINCT FROM p_lease_token
    OR command_row.lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'BRIDGE_RUNNER_LEASE_INVALID' USING ERRCODE = '42501';
  END IF;

  final_commit_sha := p_result->>'commit_sha';
  final_pr_number := CASE WHEN p_result->>'pull_request_number' ~ '^[1-9][0-9]{0,8}$'
    THEN (p_result->>'pull_request_number')::integer ELSE NULL END;
  final_pr_url := p_result->>'pull_request_url';

  IF final_commit_sha IS NOT NULL AND final_commit_sha !~ '^[0-9a-f]{40}$' THEN
    RAISE EXCEPTION 'BRIDGE_RUNNER_RESULT_INVALID' USING ERRCODE = '22023';
  END IF;

  IF p_final_status = 'awaiting_review'
    AND (final_commit_sha IS NULL OR final_pr_number IS NULL
      OR final_pr_url IS DISTINCT FROM
        ('https://github.com/' || expected_repo || '/pull/' || final_pr_number::text)) THEN
    RAISE EXCEPTION 'BRIDGE_RUNNER_RESULT_INVALID' USING ERRCODE = '22023';
  END IF;

  IF p_error_code IS NOT NULL AND p_error_code !~ '^[A-Z0-9_]{3,100}$' THEN
    RAISE EXCEPTION 'BRIDGE_RUNNER_RESULT_INVALID' USING ERRCODE = '22023';
  END IF;

  UPDATE public.bridge_commands
  SET status = p_final_status,
      error_code = p_error_code,
      runner_record = p_result || jsonb_build_object(
        'lease_token_sha256',p_lease_token_hash,
        'runner_repository',p_runner_repository,
        'runner_run_id',p_run_id,
        'finished_at',clock_timestamp()
      ),
      commit_sha = final_commit_sha,
      pull_request_number = final_pr_number,
      pull_request_url = final_pr_url,
      lease_token = NULL,
      lease_expires_at = NULL,
      completed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE id = p_command_id
  RETURNING * INTO command_row;

  RETURN jsonb_build_object('action','completed','record',to_jsonb(command_row));
END
$bridge_command_finish_runner$;

REVOKE ALL ON FUNCTION public.bridge_command_begin_dispatch(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_command_begin_dispatch(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.bridge_command_record_dispatch(uuid,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bridge_command_claim_runner(uuid,text,text,integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bridge_command_finish_runner(uuid,text,text,uuid,text,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.bridge_command_record_dispatch(uuid,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_command_claim_runner(uuid,text,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_command_finish_runner(uuid,text,text,uuid,text,text,text,jsonb) TO service_role;
