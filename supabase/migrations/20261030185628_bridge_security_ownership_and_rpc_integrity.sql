-- Generated with Supabase CLI 2.122.0; validated by replay on a disposable local Supabase database.
-- Re-check all data preconditions immediately before applying to any non-disposable database.

DO $preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM public.bridge_runs WHERE key_id IS NULL) THEN RAISE EXCEPTION 'bridge_runs has NULL key_id'; END IF;
  IF EXISTS (SELECT 1 FROM public.bridge_runs r LEFT JOIN public.bridge_keys k ON k.id=r.key_id WHERE k.id IS NULL) THEN RAISE EXCEPTION 'bridge_runs has orphan key_id'; END IF;
  IF EXISTS (SELECT 1 FROM public.bridge_idempotency i LEFT JOIN public.bridge_keys k ON k.id=i.key_id WHERE k.id IS NULL) THEN RAISE EXCEPTION 'bridge_idempotency has orphan key_id'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.bridge_keys
    WHERE cardinality(scopes) NOT BETWEEN 1 AND 2
      OR scopes <@ ARRAY['read','dispatch']::text[] IS NOT TRUE
      OR array_position(scopes,NULL) IS NOT NULL
      OR cardinality(scopes) <> (SELECT count(DISTINCT scope) FROM unnest(scopes) AS scope)
  ) THEN RAISE EXCEPTION 'bridge_keys has invalid or duplicate scopes'; END IF;
END $preflight$;

ALTER TABLE public.bridge_runs ALTER COLUMN key_id SET NOT NULL;
ALTER TABLE public.bridge_runs ADD CONSTRAINT bridge_runs_key_id_fkey FOREIGN KEY (key_id) REFERENCES public.bridge_keys(id) NOT VALID;
ALTER TABLE public.bridge_runs VALIDATE CONSTRAINT bridge_runs_key_id_fkey;
ALTER TABLE public.bridge_idempotency ADD CONSTRAINT bridge_idempotency_key_id_fkey FOREIGN KEY (key_id) REFERENCES public.bridge_keys(id) NOT VALID;
ALTER TABLE public.bridge_idempotency VALIDATE CONSTRAINT bridge_idempotency_key_id_fkey;
ALTER TABLE public.bridge_idempotency DROP CONSTRAINT bridge_idempotency_idempotency_key_key;
ALTER TABLE public.bridge_idempotency ADD CONSTRAINT bridge_idempotency_key_scope_unique UNIQUE (key_id,idempotency_key);

ALTER TABLE public.bridge_keys DROP CONSTRAINT bridge_keys_scopes_valid;
ALTER TABLE public.bridge_keys ADD CONSTRAINT bridge_keys_scopes_valid CHECK (
  cardinality(scopes) BETWEEN 1 AND 2 AND scopes <@ ARRAY['read','dispatch']::text[]
  AND array_position(scopes,NULL) IS NULL
  AND (cardinality(scopes)=1 OR (scopes @> ARRAY['read']::text[] AND scopes @> ARRAY['dispatch']::text[]))
);
CREATE INDEX IF NOT EXISTS bridge_runs_key_id_idx ON public.bridge_runs(key_id);
CREATE INDEX IF NOT EXISTS bridge_idempotency_key_id_idx ON public.bridge_idempotency(key_id);

CREATE OR REPLACE FUNCTION public.bridge_claim(p_key text,p_key_id uuid,p_fingerprint text,p_payload jsonb,p_validation_id text,p_correlation_id text,p_repo text,p_branch text,p_sha text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE r public.bridge_idempotency; t uuid:=gen_random_uuid();
BEGIN
  INSERT INTO public.bridge_idempotency(idempotency_key,key_id,request_fingerprint,request_payload,validation_id,correlation_id,repo,branch,requested_sha,lease_token,lease_expires_at)
  VALUES(p_key,p_key_id,p_fingerprint,p_payload,p_validation_id,p_correlation_id,p_repo,p_branch,p_sha,t,clock_timestamp()+interval '2 minutes')
  ON CONFLICT (key_id,idempotency_key) DO NOTHING RETURNING * INTO r;
  IF FOUND THEN RETURN jsonb_build_object('action','claimed','record',to_jsonb(r)); END IF;
  SELECT * INTO r FROM public.bridge_idempotency WHERE key_id=p_key_id AND idempotency_key=p_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'IDEMPOTENCY_CLAIM_NOT_FOUND'; END IF;
  IF r.request_fingerprint<>p_fingerprint THEN RETURN jsonb_build_object('action','conflict'); END IF;
  IF r.response IS NOT NULL THEN
    UPDATE public.bridge_idempotency SET replay_count=replay_count+1,updated_at=clock_timestamp(),
      state=CASE WHEN state='SUCCEEDED' THEN 'REPLAYED' ELSE state END,
      outcome_state=CASE WHEN state='SUCCEEDED' THEN 'SUCCEEDED' ELSE outcome_state END
    WHERE id=r.id RETURNING * INTO r;
    RETURN jsonb_build_object('action','replay','record',to_jsonb(r));
  END IF;
  IF r.lease_expires_at>clock_timestamp() THEN RETURN jsonb_build_object('action','busy','record',to_jsonb(r)); END IF;
  IF r.dispatch_intents<>'{}'::jsonb THEN
    UPDATE public.bridge_idempotency SET state='BLOCKED',outcome_state='BLOCKED',error_code='DISPATCH_OUTCOME_UNKNOWN',
      response=jsonb_build_object('idempotency_id',r.id,'error','DISPATCH_OUTCOME_UNKNOWN','state','BLOCKED'),
      http_status=409,finished_at=clock_timestamp(),updated_at=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL
    WHERE id=r.id RETURNING * INTO r;
    RETURN jsonb_build_object('action','replay','record',to_jsonb(r));
  END IF;
  UPDATE public.bridge_idempotency SET lease_token=t,lease_expires_at=clock_timestamp()+interval '2 minutes',
    attempt_count=attempt_count+1,updated_at=clock_timestamp() WHERE id=r.id RETURNING * INTO r;
  RETURN jsonb_build_object('action','claimed','record',to_jsonb(r));
END $$;

CREATE OR REPLACE FUNCTION public.bridge_prepare(p_id uuid,p_token uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE r public.bridge_idempotency; run_uuid uuid;
BEGIN
  SELECT * INTO r FROM public.bridge_idempotency WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR r.state<>'RUNNING' OR r.lease_token IS DISTINCT FROM p_token OR r.lease_expires_at IS NULL
    OR r.lease_expires_at<=clock_timestamp() OR r.response IS NOT NULL THEN RAISE EXCEPTION 'CLAIM_NOT_OWNED'; END IF;
  IF r.run_id IS NOT NULL THEN
    PERFORM 1 FROM public.bridge_runs WHERE id=r.run_id AND key_id=r.key_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'RUN_OWNERSHIP_MISMATCH'; END IF;
    RETURN r.run_id;
  END IF;
  INSERT INTO public.bridge_runs(target_repo,gate,dry_run,key_id)
  VALUES(r.repo,r.request_payload->>'gate',(r.request_payload->>'dry_run')::boolean,r.key_id) RETURNING id INTO run_uuid;
  UPDATE public.bridge_idempotency SET run_id=run_uuid,updated_at=clock_timestamp() WHERE id=p_id;
  RETURN run_uuid;
END $$;

CREATE OR REPLACE FUNCTION public.bridge_begin_dispatch(p_id uuid,p_token uuid,p_repo text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  UPDATE public.bridge_idempotency AS i SET dispatch_intents=i.dispatch_intents||jsonb_build_object(p_repo,'STARTED'),
    started_at=coalesce(i.started_at,clock_timestamp()),updated_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '2 minutes'
  WHERE i.id=p_id AND i.state='RUNNING' AND i.lease_token=p_token AND i.lease_expires_at>clock_timestamp()
    AND i.response IS NULL AND i.run_id IS NOT NULL AND NOT (i.dispatch_intents ? p_repo)
    AND ((i.repo='lite' AND p_repo='precision-lab-lite') OR (i.repo='plus' AND p_repo='precision-lab-plus')
      OR (i.repo='both' AND p_repo IN ('precision-lab-lite','precision-lab-plus')))
    AND EXISTS(SELECT 1 FROM public.bridge_runs r WHERE r.id=i.run_id AND r.key_id=i.key_id);
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.bridge_record_dispatch(p_id uuid,p_token uuid,p_run jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE r public.bridge_idempotency; v_repo text;
BEGIN
  SELECT * INTO r FROM public.bridge_idempotency WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR r.state<>'RUNNING' OR r.lease_token IS DISTINCT FROM p_token OR r.lease_expires_at IS NULL
    OR r.lease_expires_at<=clock_timestamp() OR r.response IS NOT NULL THEN RETURN false; END IF;
  IF p_run IS NULL OR jsonb_typeof(p_run)<>'object' OR p_run->>'repo' IS NULL OR p_run->>'run_id' IS NULL
    OR (p_run->>'run_id') !~ '^[1-9][0-9]*$' THEN RETURN false; END IF;
  v_repo:=p_run->>'repo';
  IF NOT ((r.repo='lite' AND v_repo='precision-lab-lite') OR (r.repo='plus' AND v_repo='precision-lab-plus')
    OR (r.repo='both' AND v_repo IN ('precision-lab-lite','precision-lab-plus')))
    OR r.dispatch_intents->>v_repo IS DISTINCT FROM 'STARTED' THEN RETURN false; END IF;
  UPDATE public.bridge_idempotency SET gh_runs=gh_runs||jsonb_build_array(p_run),
    dispatch_intents=dispatch_intents||jsonb_build_object(v_repo,'ACCEPTED'),updated_at=clock_timestamp(),
    lease_expires_at=clock_timestamp()+interval '2 minutes'
  WHERE id=p_id RETURNING * INTO r;
  UPDATE public.bridge_runs SET gh_runs=r.gh_runs WHERE id=r.run_id AND key_id=r.key_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'RUN_OWNERSHIP_MISMATCH'; END IF;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.bridge_finish(p_id uuid,p_token uuid,p_state text,p_status integer,p_response jsonb,p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $
DECLARE r public.bridge_idempotency; expected_repos text[];
BEGIN
  IF p_state IS NULL OR p_state NOT IN ('BLOCKED','FAILED','RUNNING') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF p_status IS NULL OR p_status NOT BETWEEN 100 AND 599 OR p_response IS NULL OR jsonb_typeof(p_response)<>'object' THEN
    RAISE EXCEPTION 'INVALID_FINISH_RESPONSE';
  END IF;
  SELECT * INTO r FROM public.bridge_idempotency
  WHERE id=p_id AND state='RUNNING' AND lease_token=p_token
    AND lease_expires_at>clock_timestamp() AND response IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  -- A successful 201 receipt is only valid after every requested repository
  -- has a durable ACCEPTED intent and exactly one registered GitHub run.
  IF p_state='RUNNING' THEN
    IF p_status<>201 OR r.run_id IS NULL THEN RETURN false; END IF;
    expected_repos := CASE r.repo
      WHEN 'lite' THEN ARRAY['precision-lab-lite']::text[]
      WHEN 'plus' THEN ARRAY['precision-lab-plus']::text[]
      WHEN 'both' THEN ARRAY['precision-lab-lite','precision-lab-plus']::text[]
      ELSE ARRAY[]::text[]
    END;
    IF cardinality(expected_repos)=0 THEN RETURN false; END IF;
    IF jsonb_typeof(r.dispatch_intents) IS DISTINCT FROM 'object'
      OR jsonb_typeof(r.gh_runs) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    IF jsonb_array_length(r.gh_runs)<>cardinality(expected_repos) THEN RETURN false; END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(expected_repos) AS expected(repo)
      WHERE r.dispatch_intents->>expected.repo IS DISTINCT FROM 'ACCEPTED'
        OR (SELECT count(*) FROM jsonb_array_elements(r.gh_runs) AS item
            WHERE item->>'repo'=expected.repo)<>1
    ) THEN RETURN false; END IF;
    IF EXISTS (
      SELECT 1 FROM public.bridge_runs br
      WHERE br.id=r.run_id AND br.key_id=r.key_id
    ) IS NOT TRUE THEN RETURN false; END IF;
  END IF;

  UPDATE public.bridge_idempotency SET state=p_state,outcome_state=p_state,http_status=p_status,response=p_response,error_code=p_error,
    updated_at=clock_timestamp(),finished_at=CASE WHEN p_state='RUNNING' THEN NULL ELSE clock_timestamp() END,
    lease_token=NULL,lease_expires_at=NULL
  WHERE id=p_id AND state='RUNNING' AND lease_token=p_token AND lease_expires_at>clock_timestamp() AND response IS NULL;
  RETURN FOUND;
END $;

REVOKE ALL ON FUNCTION public.bridge_claim(text,uuid,text,jsonb,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bridge_prepare(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bridge_begin_dispatch(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bridge_record_dispatch(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bridge_finish(uuid,uuid,text,integer,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_claim(text,uuid,text,jsonb,text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_prepare(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_begin_dispatch(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_record_dispatch(uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_finish(uuid,uuid,text,integer,jsonb,text) TO service_role;
