-- Functional contract tests for the five Bridge RPCs.
-- Run only against the disposable local Supabase database after db reset.
-- The transaction is rolled back; no test rows persist.

BEGIN;

-- Exercise SECURITY INVOKER RPCs as the actual backend database role.
SET LOCAL ROLE service_role;

DO $test$
DECLARE
  key_a uuid := gen_random_uuid();
  key_b uuid := gen_random_uuid();
  idem text := 'rpc-functional-' || gen_random_uuid()::text;
  fingerprint text := repeat('a',64);
  payload_lite jsonb := jsonb_build_object('target_repo','lite','gate','h1d','dry_run',true);
  payload_both jsonb := jsonb_build_object('target_repo','both','gate','cumulative','dry_run',false);
  claim_a jsonb;
  claim_b jsonb;
  claim_both jsonb;
  claim_recovered jsonb;
  claim_id uuid;
  token_a uuid;
  token_b uuid;
  token_both uuid;
  run_a uuid;
  run_both uuid;
  ok boolean;
  rec public.bridge_idempotency;
BEGIN
  INSERT INTO public.bridge_keys(id,label,key_hash,key_prefix,expires_at,scopes)
  VALUES
    (key_a,'rpc functional test A',md5(key_a::text),'rpc-test-a',clock_timestamp()+interval '1 day',ARRAY['read','dispatch']),
    (key_b,'rpc functional test B',md5(key_b::text),'rpc-test-b',clock_timestamp()+interval '1 day',ARRAY['read']);

  -- bridge_claim: first claim, same-owner busy, fingerprint conflict, and
  -- same idempotency key independently claimable by a different credential.
  claim_a := public.bridge_claim(idem,key_a,fingerprint,payload_lite,'validation-a','correlation-a','lite','main',NULL);
  IF claim_a->>'action' IS DISTINCT FROM 'claimed' THEN RAISE EXCEPTION 'claim A did not claim'; END IF;
  claim_id := (claim_a->'record'->>'id')::uuid;
  token_a := (claim_a->'record'->>'lease_token')::uuid;

  claim_b := public.bridge_claim(idem,key_a,fingerprint,payload_lite,'validation-a','correlation-a','lite','main',NULL);
  IF claim_b->>'action' IS DISTINCT FROM 'busy' THEN RAISE EXCEPTION 'same-owner retry was not busy'; END IF;

  claim_b := public.bridge_claim(idem,key_a,repeat('b',64),payload_lite,'validation-a','correlation-a','lite','main',NULL);
  IF claim_b->>'action' IS DISTINCT FROM 'conflict' THEN RAISE EXCEPTION 'fingerprint mismatch was not rejected'; END IF;

  claim_b := public.bridge_claim(idem,key_b,fingerprint,payload_lite,'validation-b','correlation-b','lite','main',NULL);
  IF claim_b->>'action' IS DISTINCT FROM 'claimed' THEN RAISE EXCEPTION 'same idempotency key was not isolated by owner'; END IF;
  token_b := (claim_b->'record'->>'lease_token')::uuid;

  -- bridge_prepare: create an owner-bound run and return the same run on retry.
  run_a := public.bridge_prepare(claim_id,token_a);
  IF NOT EXISTS (SELECT 1 FROM public.bridge_runs WHERE id=run_a AND key_id=key_a) THEN
    RAISE EXCEPTION 'prepare did not create an owner-bound run';
  END IF;
  IF public.bridge_prepare(claim_id,token_a) IS DISTINCT FROM run_a THEN
    RAISE EXCEPTION 'prepare retry created a second run';
  END IF;

  -- bridge_begin_dispatch: reject the wrong repository and duplicate intent.
  IF public.bridge_begin_dispatch(claim_id,token_a,'precision-lab-plus') THEN
    RAISE EXCEPTION 'begin_dispatch accepted an unrequested repository';
  END IF;
  IF NOT public.bridge_begin_dispatch(claim_id,token_a,'precision-lab-lite') THEN
    RAISE EXCEPTION 'begin_dispatch rejected the requested repository';
  END IF;
  IF public.bridge_begin_dispatch(claim_id,token_a,'precision-lab-lite') THEN
    RAISE EXCEPTION 'begin_dispatch accepted a duplicate intent';
  END IF;

  -- bridge_record_dispatch: reject malformed and wrong-repository receipts;
  -- accept one valid receipt and reject its duplicate.
  IF public.bridge_record_dispatch(claim_id,token_a,
      jsonb_build_object('repo','precision-lab-lite','run_id','not-a-number','html_url',NULL)) THEN
    RAISE EXCEPTION 'record_dispatch accepted a malformed run ID';
  END IF;
  IF public.bridge_record_dispatch(claim_id,token_a,
      jsonb_build_object('repo','precision-lab-plus','run_id',12345,'html_url',NULL)) THEN
    RAISE EXCEPTION 'record_dispatch accepted a mismatched repository';
  END IF;
  IF NOT public.bridge_record_dispatch(claim_id,token_a,
      jsonb_build_object('repo','precision-lab-lite','run_id',12345,
        'html_url','https://github.com/example/precision-lab-lite/actions/runs/12345')) THEN
    RAISE EXCEPTION 'record_dispatch rejected a valid receipt';
  END IF;
  IF public.bridge_record_dispatch(claim_id,token_a,
      jsonb_build_object('repo','precision-lab-lite','run_id',12346,'html_url',NULL)) THEN
    RAISE EXCEPTION 'record_dispatch accepted a duplicate receipt';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bridge_runs WHERE id=run_a AND key_id=key_a
      AND jsonb_array_length(gh_runs)=1) THEN
    RAISE EXCEPTION 'run receipt was not persisted to the owned run';
  END IF;

  -- bridge_finish: valid initial 201 receipt, then idempotent replay.
  ok := public.bridge_finish(claim_id,token_a,'RUNNING',201,
    jsonb_build_object('id',run_a,'idempotency_id',claim_id,'status_url','/api/runs/'||run_a));
  IF NOT ok THEN RAISE EXCEPTION 'finish rejected a complete successful dispatch'; END IF;
  claim_both := public.bridge_claim(idem,key_a,fingerprint,payload_lite,'validation-a','correlation-a','lite','main',NULL);
  IF claim_both->>'action' IS DISTINCT FROM 'replay' THEN RAISE EXCEPTION 'finished request did not replay'; END IF;
  IF (claim_both->'record'->>'replay_count')::integer < 1 THEN RAISE EXCEPTION 'replay counter did not increment'; END IF;

  -- A stale lease must fence all mutating RPCs; claim may recover only before
  -- any dispatch intent has been written.
  claim_recovered := public.bridge_claim(idem || ':recover',key_a,fingerprint,payload_lite,
    'validation-a','correlation-a','lite','main',NULL);
  IF claim_recovered->>'action' IS DISTINCT FROM 'claimed' THEN RAISE EXCEPTION 'recovery fixture claim failed'; END IF;
  claim_id := (claim_recovered->'record'->>'id')::uuid;
  token_a := (claim_recovered->'record'->>'lease_token')::uuid;
  UPDATE public.bridge_idempotency SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=claim_id;
  claim_both := public.bridge_claim(idem || ':recover',key_a,fingerprint,payload_lite,
    'validation-a','correlation-a','lite','main',NULL);
  IF claim_both->>'action' IS DISTINCT FROM 'claimed' THEN RAISE EXCEPTION 'expired pre-dispatch claim did not recover'; END IF;
  token_both := (claim_both->'record'->>'lease_token')::uuid;
  IF token_both=token_a OR (claim_both->'record'->>'attempt_count')::integer<>2 THEN
    RAISE EXCEPTION 'lease recovery did not fence the previous owner';
  END IF;
  IF public.bridge_begin_dispatch(claim_id,token_a,'precision-lab-lite') THEN
    RAISE EXCEPTION 'stale lease owner dispatched';
  END IF;
  IF public.bridge_finish(claim_id,token_a,'FAILED',503,jsonb_build_object('error','stale')) THEN
    RAISE EXCEPTION 'stale lease owner finished the claim';
  END IF;

  -- A BOTH request cannot receive a 201 receipt until both repositories have
  -- accepted a durable receipt. This is the key success-transition invariant.
  claim_both := public.bridge_claim(idem || ':both',key_a,fingerprint,payload_both,
    'validation-both','correlation-both','both','main',NULL);
  IF claim_both->>'action' IS DISTINCT FROM 'claimed' THEN RAISE EXCEPTION 'both claim failed'; END IF;
  claim_id := (claim_both->'record'->>'id')::uuid;
  token_both := (claim_both->'record'->>'lease_token')::uuid;
  run_both := public.bridge_prepare(claim_id,token_both);
  IF NOT public.bridge_begin_dispatch(claim_id,token_both,'precision-lab-lite') THEN
    RAISE EXCEPTION 'both request could not start Lite';
  END IF;
  IF NOT public.bridge_record_dispatch(claim_id,token_both,
      jsonb_build_object('repo','precision-lab-lite','run_id',22345,'html_url',NULL)) THEN
    RAISE EXCEPTION 'both request could not record Lite';
  END IF;
  IF public.bridge_finish(claim_id,token_both,'RUNNING',201,
      jsonb_build_object('id',run_both,'idempotency_id',claim_id)) THEN
    RAISE EXCEPTION 'incomplete BOTH dispatch incorrectly received 201 receipt';
  END IF;
  IF NOT public.bridge_begin_dispatch(claim_id,token_both,'precision-lab-plus') THEN
    RAISE EXCEPTION 'both request could not start Plus';
  END IF;
  IF NOT public.bridge_record_dispatch(claim_id,token_both,
      jsonb_build_object('repo','precision-lab-plus','run_id',22346,'html_url',NULL)) THEN
    RAISE EXCEPTION 'both request could not record Plus';
  END IF;
  IF NOT public.bridge_finish(claim_id,token_both,'RUNNING',201,
      jsonb_build_object('id',run_both,'idempotency_id',claim_id)) THEN
    RAISE EXCEPTION 'complete BOTH dispatch did not receive 201 receipt';
  END IF;

  -- No permanent fixture rows survive this script.
END
$test$;

ROLLBACK;
