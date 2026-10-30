CREATE TABLE public.bridge_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  key_prefix text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz
);
GRANT ALL ON public.bridge_keys TO service_role;
ALTER TABLE public.bridge_keys ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.bridge_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_repo text NOT NULL,
  gate text NOT NULL,
  dry_run boolean NOT NULL,
  dispatched_at timestamptz NOT NULL DEFAULT now(),
  gh_runs jsonb NOT NULL DEFAULT '[]'::jsonb,
  key_id uuid
);
GRANT ALL ON public.bridge_runs TO service_role;
ALTER TABLE public.bridge_runs ENABLE ROW LEVEL SECURITY;
CREATE INDEX bridge_runs_dedupe_idx ON public.bridge_runs (target_repo, gate, dry_run, dispatched_at DESC);

CREATE TABLE public.bridge_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  endpoint text NOT NULL,
  key_prefix text,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  http_status int NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT ALL ON public.bridge_calls TO service_role;
ALTER TABLE public.bridge_calls ENABLE ROW LEVEL SECURITY;
CREATE INDEX bridge_calls_created_idx ON public.bridge_calls (created_at DESC);