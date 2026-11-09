ALTER TABLE public.bridge_keys
  ADD COLUMN IF NOT EXISTS scopes text[] NOT NULL DEFAULT ARRAY['read']::text[];

ALTER TABLE public.bridge_keys
  DROP CONSTRAINT IF EXISTS bridge_keys_scopes_valid;

ALTER TABLE public.bridge_keys
  ADD CONSTRAINT bridge_keys_scopes_valid
  CHECK (
    cardinality(scopes) BETWEEN 1 AND 2
    AND scopes <@ ARRAY['read', 'dispatch']::text[]
  );

COMMENT ON COLUMN public.bridge_keys.scopes IS
  'Least-privilege API permissions. Existing keys default to read only; dispatch must be granted explicitly.';
