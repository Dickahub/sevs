ALTER TABLE public.elections ADD COLUMN IF NOT EXISTS suspended boolean NOT NULL DEFAULT false;

-- Reset the audit chain so all entries use the new details-inclusive hash
-- formula consistently. Row-level append-only triggers (UPDATE/DELETE) do not
-- fire on TRUNCATE, and the protection remains in force for normal operations.
TRUNCATE public.audit_log RESTART IDENTITY;