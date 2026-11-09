CREATE TABLE public.bridge_idempotency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  key_id uuid NOT NULL,
  validation_id text NOT NULL,
  correlation_id text NOT NULL,
  repo text NOT NULL,
  branch text NOT NULL,
  requested_sha text,
  request_fingerprint text NOT NULL,
  request_payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'RUNNING' CHECK (state IN ('BLOCKED','FAILED','RUNNING','SUCCEEDED','REPLAYED')),
  outcome_state text CHECK (outcome_state IN ('BLOCKED','FAILED','RUNNING','SUCCEEDED')),
  response jsonb,
  http_status integer,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 1,
  replay_count integer NOT NULL DEFAULT 0,
  run_id uuid REFERENCES public.bridge_runs(id),
  gh_runs jsonb NOT NULL DEFAULT '[]'::jsonb,
  job_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  dispatch_intents jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT bridge_idempotency_key_length CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  CONSTRAINT bridge_idempotency_fingerprint CHECK (request_fingerprint ~ '^[0-9a-f]{64}$')
);
GRANT ALL ON public.bridge_idempotency TO service_role;
REVOKE ALL ON public.bridge_idempotency FROM PUBLIC, anon, authenticated;
ALTER TABLE public.bridge_idempotency ENABLE ROW LEVEL SECURITY;
CREATE INDEX bridge_idempotency_run_idx ON public.bridge_idempotency(run_id);
CREATE INDEX bridge_idempotency_lease_idx ON public.bridge_idempotency(lease_expires_at) WHERE state = 'RUNNING';

CREATE FUNCTION public.bridge_claim(p_key text, p_key_id uuid, p_fingerprint text, p_payload jsonb, p_validation_id text, p_correlation_id text, p_repo text, p_branch text, p_sha text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE r public.bridge_idempotency; t uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.bridge_idempotency(idempotency_key,key_id,request_fingerprint,request_payload,validation_id,correlation_id,repo,branch,requested_sha,lease_token,lease_expires_at)
  VALUES(p_key,p_key_id,p_fingerprint,p_payload,p_validation_id,p_correlation_id,p_repo,p_branch,p_sha,t,clock_timestamp()+interval '2 minutes')
  ON CONFLICT (idempotency_key) DO NOTHING RETURNING * INTO r;
  IF FOUND THEN RETURN jsonb_build_object('action','claimed','record',to_jsonb(r)); END IF;
  SELECT * INTO r FROM public.bridge_idempotency WHERE idempotency_key=p_key FOR UPDATE;
  IF r.key_id <> p_key_id OR r.request_fingerprint <> p_fingerprint THEN
    RETURN jsonb_build_object('action','conflict');
  END IF;
  IF r.response IS NOT NULL THEN
    UPDATE public.bridge_idempotency SET replay_count=replay_count+1,updated_at=clock_timestamp(),
      state=CASE WHEN state='SUCCEEDED' THEN 'REPLAYED' ELSE state END,
      outcome_state=CASE WHEN state='SUCCEEDED' THEN 'SUCCEEDED' ELSE outcome_state END
      WHERE id=r.id RETURNING * INTO r;
    RETURN jsonb_build_object('action','replay','record',to_jsonb(r));
  END IF;
  IF r.lease_expires_at > clock_timestamp() THEN
    RETURN jsonb_build_object('action','busy','record',to_jsonb(r));
  END IF;
  IF r.dispatch_intents <> '{}'::jsonb THEN
    UPDATE public.bridge_idempotency SET state='BLOCKED',outcome_state='BLOCKED',error_code='DISPATCH_OUTCOME_UNKNOWN',
      response=jsonb_build_object('idempotency_id',r.id,'error','DISPATCH_OUTCOME_UNKNOWN','state','BLOCKED'),http_status=409,
      finished_at=clock_timestamp(),updated_at=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL
      WHERE id=r.id RETURNING * INTO r;
    RETURN jsonb_build_object('action','replay','record',to_jsonb(r));
  END IF;
  UPDATE public.bridge_idempotency SET lease_token=t,lease_expires_at=clock_timestamp()+interval '2 minutes',
    attempt_count=attempt_count+1,updated_at=clock_timestamp() WHERE id=r.id RETURNING * INTO r;
  RETURN jsonb_build_object('action','claimed','record',to_jsonb(r));
END $$;
REVOKE ALL ON FUNCTION public.bridge_claim(text,uuid,text,jsonb,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_claim(text,uuid,text,jsonb,text,text,text,text,text) TO service_role;

CREATE FUNCTION public.bridge_prepare(p_id uuid,p_token uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE r public.bridge_idempotency; run_uuid uuid;
BEGIN
  SELECT * INTO r FROM public.bridge_idempotency WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR r.state<>'RUNNING' OR r.lease_token IS DISTINCT FROM p_token OR r.lease_expires_at<=clock_timestamp() OR r.response IS NOT NULL THEN
    RAISE EXCEPTION 'CLAIM_NOT_OWNED';
  END IF;
  IF r.run_id IS NOT NULL THEN RETURN r.run_id; END IF;
  INSERT INTO public.bridge_runs(target_repo,gate,dry_run,key_id) VALUES(r.repo,r.request_payload->>'gate',(r.request_payload->>'dry_run')::boolean,r.key_id) RETURNING id INTO run_uuid;
  UPDATE public.bridge_idempotency SET run_id=run_uuid,updated_at=clock_timestamp() WHERE id=p_id;
  RETURN run_uuid;
END $$;
REVOKE ALL ON FUNCTION public.bridge_prepare(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_prepare(uuid,uuid) TO service_role;

CREATE FUNCTION public.bridge_begin_dispatch(p_id uuid,p_token uuid,p_repo text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  UPDATE public.bridge_idempotency SET dispatch_intents=dispatch_intents||jsonb_build_object(p_repo,'STARTED'),
    started_at=coalesce(started_at,clock_timestamp()),updated_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '2 minutes'
    WHERE id=p_id AND state='RUNNING' AND lease_token=p_token AND lease_expires_at>clock_timestamp()
      AND response IS NULL AND run_id IS NOT NULL AND NOT dispatch_intents ? p_repo
      AND ((repo='lite' AND p_repo='precision-lab-lite') OR (repo='plus' AND p_repo='precision-lab-plus') OR (repo='both' AND p_repo IN ('precision-lab-lite','precision-lab-plus')));
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.bridge_begin_dispatch(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_begin_dispatch(uuid,uuid,text) TO service_role;

CREATE FUNCTION public.bridge_record_dispatch(p_id uuid,p_token uuid,p_run jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE r public.bridge_idempotency;
BEGIN
  UPDATE public.bridge_idempotency SET gh_runs=gh_runs||jsonb_build_array(p_run),
    dispatch_intents=dispatch_intents||jsonb_build_object(p_run->>'repo','ACCEPTED'),updated_at=clock_timestamp(),
    lease_expires_at=clock_timestamp()+interval '2 minutes'
    WHERE id=p_id AND state='RUNNING' AND lease_token=p_token AND response IS NULL
      AND dispatch_intents->>(p_run->>'repo')='STARTED' RETURNING * INTO r;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.bridge_runs SET gh_runs=r.gh_runs WHERE id=r.run_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.bridge_record_dispatch(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_record_dispatch(uuid,uuid,jsonb) TO service_role;

CREATE FUNCTION public.bridge_finish(p_id uuid,p_token uuid,p_state text,p_status integer,p_response jsonb,p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF p_state NOT IN ('BLOCKED','FAILED','RUNNING','SUCCEEDED') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  UPDATE public.bridge_idempotency SET state=p_state,outcome_state=p_state,http_status=p_status,response=p_response,error_code=p_error,
    updated_at=clock_timestamp(),finished_at=CASE WHEN p_state='RUNNING' THEN NULL ELSE clock_timestamp() END,
    lease_token=NULL,lease_expires_at=NULL
    WHERE id=p_id AND state='RUNNING' AND lease_token=p_token AND response IS NULL;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.bridge_finish(uuid,uuid,text,integer,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_finish(uuid,uuid,text,integer,jsonb,text) TO service_role;
