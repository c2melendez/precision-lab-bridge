-- Functional tests for the M1 generic command intake RPC.
-- Run only against the disposable local Supabase database after db reset.
-- The transaction is rolled back and never invokes GitHub or Runner.

BEGIN;
SET LOCAL ROLE service_role;

DO $test$
DECLARE
  key_a uuid := gen_random_uuid();
  key_b uuid := gen_random_uuid();
  legacy_key uuid := gen_random_uuid();
  idem text := 'm1-rpc-' || gen_random_uuid()::text;
  fingerprint text := repeat('a',64);
  payload jsonb := jsonb_build_object();
  observer_context jsonb := jsonb_build_object(
    'repo','lite',
    'repository_full_name','c2melendez/precision-lab-lite',
    'canonical_branch','qa/syntax-audit-in625-a1',
    'current_head_sha',repeat('b',40),
    'state_status','CURRENT',
    'continuity_revision',1
  );
  accepted jsonb;
  replayed jsonb;
  conflict_result jsonb;
  other_owner jsonb;
  legacy_error text;
  command_id uuid;
BEGIN
  INSERT INTO public.bridge_keys(id,label,key_hash,key_prefix,expires_at,scopes)
  VALUES
    (key_a,'m1 functional A',md5(key_a::text),'m1-func-a',clock_timestamp()+interval '1 day',ARRAY['command:submit','command:read']),
    (key_b,'m1 functional B',md5(key_b::text),'m1-func-b',clock_timestamp()+interval '1 day',ARRAY['command:submit']),
    (legacy_key,'m1 legacy key',md5(legacy_key::text),'m1-legacy',clock_timestamp()+interval '1 day',ARRAY['read','dispatch']);

  accepted := public.bridge_submit_command(
    key_a,idem,'repo.inspect','lite','qa/syntax-audit-in625-a1',repeat('b',40),fingerprint,
    payload,observer_context,'corr-a','validation-a'
  );
  IF accepted->>'action' IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'first command submission was not accepted';
  END IF;
  command_id := (accepted->'record'->>'id')::uuid;
  IF accepted->'record'->>'status' IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'new command must begin in accepted state';
  END IF;

  replayed := public.bridge_submit_command(
    key_a,idem,'repo.inspect','lite','qa/syntax-audit-in625-a1',repeat('b',40),fingerprint,
    payload,observer_context,'corr-a','validation-a'
  );
  IF replayed->>'action' IS DISTINCT FROM 'replay'
    OR (replayed->'record'->>'id')::uuid IS DISTINCT FROM command_id
    OR (replayed->'record'->>'replay_count')::integer <> 1
    OR replayed->'record'->'response' IS DISTINCT FROM accepted->'record'->'response' THEN
    RAISE EXCEPTION 'same-key command replay did not reuse the durable receipt';
  END IF;

  conflict_result := public.bridge_submit_command(
    key_a,idem,'repo.inspect','lite','qa/syntax-audit-in625-a1',repeat('b',40),repeat('c',64),
    payload,observer_context,'corr-a','validation-a'
  );
  IF conflict_result->>'action' IS DISTINCT FROM 'conflict' THEN
    RAISE EXCEPTION 'same idempotency key with changed fingerprint was not rejected';
  END IF;

  other_owner := public.bridge_submit_command(
    key_b,idem,'repo.inspect','lite','qa/syntax-audit-in625-a1',repeat('b',40),fingerprint,
    payload,observer_context,'corr-b','validation-b'
  );
  IF other_owner->>'action' IS DISTINCT FROM 'accepted'
    OR (other_owner->'record'->>'id')::uuid = command_id THEN
    RAISE EXCEPTION 'idempotency key was not isolated by credential owner';
  END IF;

  BEGIN
    PERFORM public.bridge_submit_command(
      legacy_key,idem || '-legacy','repo.inspect','lite','qa/syntax-audit-in625-a1',repeat('b',40),fingerprint,
      payload,observer_context,'corr-legacy','validation-legacy'
    );
    RAISE EXCEPTION 'legacy read/dispatch key unexpectedly gained command:submit';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS legacy_error = MESSAGE_TEXT;
    IF legacy_error NOT LIKE '%BRIDGE_COMMAND_SCOPE_DENIED%' THEN RAISE; END IF;
  END;

  IF (SELECT scopes FROM public.bridge_keys WHERE id=legacy_key) IS DISTINCT FROM ARRAY['read','dispatch']::text[] THEN
    RAISE EXCEPTION 'legacy key scopes were modified';
  END IF;

  IF (SELECT count(*) FROM public.bridge_commands WHERE key_id=key_a AND idempotency_key=idem) <> 1
    OR (SELECT count(*) FROM public.bridge_commands WHERE key_id=key_b AND idempotency_key=idem) <> 1 THEN
    RAISE EXCEPTION 'owner-scoped uniqueness was not preserved';
  END IF;
END
$test$;

ROLLBACK;
