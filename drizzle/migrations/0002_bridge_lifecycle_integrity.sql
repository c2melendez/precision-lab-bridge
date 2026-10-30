ALTER TABLE public.bridge_idempotency ADD COLUMN workflow_result jsonb;
ALTER TABLE public.bridge_idempotency ADD CONSTRAINT bridge_idempotency_lifecycle CHECK (
  (response IS NULL AND http_status IS NULL AND state='RUNNING' AND outcome_state IS NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND finished_at IS NULL)
  OR
  (response IS NOT NULL AND http_status BETWEEN 100 AND 599 AND lease_token IS NULL AND lease_expires_at IS NULL
    AND ((state='RUNNING' AND outcome_state='RUNNING' AND finished_at IS NULL)
      OR (state IN ('BLOCKED','FAILED','SUCCEEDED') AND outcome_state=state AND finished_at IS NOT NULL)
      OR (state='REPLAYED' AND outcome_state='SUCCEEDED' AND finished_at IS NOT NULL)))
);
COMMENT ON COLUMN public.bridge_idempotency.workflow_result IS 'Sanitized GitHub workflow outcomes; dispatch receipt remains immutable in response.';