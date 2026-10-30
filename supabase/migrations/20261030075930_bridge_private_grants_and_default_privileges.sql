-- Enforce least-privilege defaults for future objects created by postgres in public.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Preserve only the Bridge server role on the current storage tables and RPCs.
REVOKE ALL ON TABLE public.bridge_keys, public.bridge_runs, public.bridge_calls, public.bridge_idempotency
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.bridge_keys, public.bridge_runs, public.bridge_calls, public.bridge_idempotency
  TO service_role;

GRANT EXECUTE ON FUNCTION public.bridge_claim(text,uuid,text,jsonb,text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_prepare(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_begin_dispatch(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_record_dispatch(uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_finish(uuid,uuid,text,integer,jsonb,text) TO service_role;
