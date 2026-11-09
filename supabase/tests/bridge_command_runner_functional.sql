-- M2 command dispatch, OIDC-to-run binding, leases and idempotent callback.
-- Runs only on disposable local Supabase database; no GitHub workflow is dispatched.

BEGIN;
SET LOCAL ROLE service_role;

DO $test$
DECLARE
  key_id uuid := gen_random_uuid();
  command_id uuid := gen_random_uuid();
  dispatch jsonb;
  claim jsonb;
  replay_claim jsonb;
  finish_result jsonb;
  replay_finish jsonb;
  lease uuid;
  denied boolean := false;
  result jsonb := jsonb_build_object(
    'validation_profile','unit',
    'validation_conclusion','success',
    'summary','M2 disposable database contract test',
    'base_sha',repeat('b',40),
    'head_sha',repeat('c',40),
    'commit_sha',repeat('c',40),
    'pull_request_number',321,
    'pull_request_url','https://github.com/c2melendez/precision-lab-lite/pull/321',
    'runner_run_url','https://github.com/c2melendez/precision-lab-lite/actions/runs/987654321'
  );
BEGIN
  INSERT INTO public.bridge_keys(id,label,key_hash,key_prefix,expires_at,scopes)
  VALUES (key_id,'M2 runner contract test',md5(key_id::text),'m2-runner',clock_timestamp()+interval '1 day',ARRAY['command:submit']);

  INSERT INTO public.bridge_commands(
    id,key_id,idempotency_key,command_type,target_repo,expected_branch,expected_sha,
    request_fingerprint,request_payload,observer_context,correlation_id,validation_id,status
  ) VALUES (
    command_id,key_id,'m2-'||command_id::text,'repo.patch','lite','qa/syntax-audit-in625-a1',repeat('b',40),
    repeat('a',64),jsonb_build_object('operations',jsonb_build_array(jsonb_build_object(
      'action','create','path','src/m2-runner-probe.txt','content','M2'
    ))),
    jsonb_build_object('repo','lite','repository_full_name','c2melendez/precision-lab-lite',
      'canonical_branch','qa/syntax-audit-in625-a1','current_head_sha',repeat('b',40),'state_status','CURRENT'),
    'm2-correlation','m2-validation','accepted'
  );

  dispatch := public.bridge_command_begin_dispatch(command_id);
  IF dispatch->>'action' IS DISTINCT FROM 'started'
    OR dispatch->'record'->>'status' IS DISTINCT FROM 'validating' THEN
    RAISE EXCEPTION 'dispatch intent was not durably created before workflow_dispatch';
  END IF;

  replay_claim := public.bridge_command_begin_dispatch(command_id);
  IF replay_claim->>'action' IS DISTINCT FROM 'replay'
    OR replay_claim->'record'->>'status' IS DISTINCT FROM 'validating' THEN
    RAISE EXCEPTION 'duplicate request must not create a second dispatch intent';
  END IF;

  dispatch := public.bridge_command_record_dispatch(
    command_id,'queued','987654321',
    'https://github.com/c2melendez/precision-lab-lite/actions/runs/987654321',NULL
  );
  IF dispatch->>'action' IS DISTINCT FROM 'recorded'
    OR dispatch->'record'->>'status' IS DISTINCT FROM 'queued'
    OR dispatch->'record'->'response'->>'status' IS DISTINCT FROM 'queued'
    OR dispatch->'record'->'response'->>'dispatch_outcome' IS DISTINCT FROM 'queued'
    OR dispatch->'record'->'response'->>'execution_enabled' IS DISTINCT FROM 'true'
    OR dispatch->'record'->'response'->>'actions_run_id' IS DISTINCT FROM '987654321' THEN
    RAISE EXCEPTION 'dispatch outcome was not recorded as queued';
  END IF;

  dispatch := public.bridge_command_record_dispatch(
    command_id,'queued','987654321',
    'https://github.com/c2melendez/precision-lab-lite/actions/runs/987654321',NULL
  );
  IF dispatch->>'action' IS DISTINCT FROM 'replay' THEN
    RAISE EXCEPTION 'duplicate dispatch receipt was not idempotent';
  END IF;

  BEGIN
    PERFORM public.bridge_command_claim_runner(
      command_id,'c2melendez/precision-lab-plus','987654321',1
    );
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'wrong repository was allowed to claim a Lite command'; END IF;

  claim := public.bridge_command_claim_runner(
    command_id,'c2melendez/precision-lab-lite','987654321',1
  );
  IF claim->>'action' IS DISTINCT FROM 'claimed'
    OR claim->'manifest'->>'expected_sha' IS DISTINCT FROM repeat('b',40)
    OR claim->'manifest'->>'command_type' IS DISTINCT FROM 'repo.patch' THEN
    RAISE EXCEPTION 'valid Runner could not claim the command manifest';
  END IF;
  lease := (claim->>'lease_token')::uuid;

  replay_claim := public.bridge_command_claim_runner(
    command_id,'c2melendez/precision-lab-lite','987654321',1
  );
  IF replay_claim->>'action' IS DISTINCT FROM 'replay'
    OR (replay_claim->>'lease_token')::uuid IS DISTINCT FROM lease THEN
    RAISE EXCEPTION 'same-run claim retry did not return the original lease';
  END IF;

  denied := false;
  BEGIN
    PERFORM public.bridge_command_finish_runner(
      command_id,'c2melendez/precision-lab-lite','987654321',gen_random_uuid(),repeat('a',64),
      'awaiting_review',NULL,result
    );
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'wrong lease token was allowed to complete the command'; END IF;

  finish_result := public.bridge_command_finish_runner(
    command_id,'c2melendez/precision-lab-lite','987654321',lease,repeat('a',64),
    'awaiting_review',NULL,result
  );
  IF finish_result->>'action' IS DISTINCT FROM 'completed'
    OR finish_result->'record'->>'status' IS DISTINCT FROM 'awaiting_review'
    OR finish_result->'record'->>'pull_request_number' IS DISTINCT FROM '321'
    OR finish_result->'record'->>'commit_sha' IS DISTINCT FROM repeat('c',40) THEN
    RAISE EXCEPTION 'valid Runner callback did not persist commit and PR receipt';
  END IF;

  replay_finish := public.bridge_command_finish_runner(
    command_id,'c2melendez/precision-lab-lite','987654321',lease,repeat('a',64),
    'awaiting_review',NULL,result
  );
  IF replay_finish->>'action' IS DISTINCT FROM 'replay' THEN
    RAISE EXCEPTION 'duplicate callback did not return the original terminal record';
  END IF;

  IF (SELECT status FROM public.bridge_commands WHERE id=command_id) <> 'awaiting_review'
    OR (SELECT lease_token FROM public.bridge_commands WHERE id=command_id) IS NOT NULL
    OR (SELECT attempt_count FROM public.bridge_commands WHERE id=command_id) <> 1 THEN
    RAISE EXCEPTION 'final command state or lease cleanup is invalid';
  END IF;
END
$test$;

ROLLBACK;
