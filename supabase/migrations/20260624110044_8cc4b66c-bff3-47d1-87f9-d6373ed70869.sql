-- 1. Eligibility vote tracking (the only voter <-> participation link)
ALTER TABLE public.election_eligibility
  ADD COLUMN IF NOT EXISTS has_voted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voted_at timestamptz;

-- 2. Election lifecycle / results
ALTER TABLE public.elections
  ADD COLUMN IF NOT EXISTS results_published boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tally jsonb,
  ADD COLUMN IF NOT EXISTS tallied_at timestamptz;

-- 3. Audit details column
ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS details text NOT NULL DEFAULT '';

-- 4. Receipt token on receipts
ALTER TABLE public.ballot_receipts
  ADD COLUMN IF NOT EXISTS receipt_token text;

-- 5. Encrypted, anonymous ballots (NO voter reference of any kind)
CREATE TABLE IF NOT EXISTS public.ballots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id uuid NOT NULL REFERENCES public.elections(id) ON DELETE CASCADE,
  ciphertext text NOT NULL,
  iv text NOT NULL,
  encrypted_key text NOT NULL,
  signature text NOT NULL,
  ballot_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.ballots TO service_role;
ALTER TABLE public.ballots ENABLE ROW LEVEL SECURITY;
-- No policies: encrypted ballots are readable only by the server (service role).

-- 6. System signing keys (singleton; service role only)
CREATE TABLE IF NOT EXISTS public.system_keys (
  id boolean PRIMARY KEY DEFAULT true,
  signing_public_key text NOT NULL,
  signing_private_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT system_keys_singleton CHECK (id)
);
GRANT ALL ON public.system_keys TO service_role;
ALTER TABLE public.system_keys ENABLE ROW LEVEL SECURITY;

-- 7. Audit log immutability at the database level (append-only / INSERT-only)
REVOKE UPDATE, DELETE ON public.audit_log FROM authenticated;
REVOKE UPDATE, DELETE ON public.audit_log FROM anon;

CREATE OR REPLACE FUNCTION public.prevent_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS audit_log_no_update ON public.audit_log;
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_mutation();

DROP TRIGGER IF EXISTS audit_log_no_delete ON public.audit_log;
CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_mutation();

-- 8. Atomic ballot cast: store encrypted ballot, mark voted, store receipt
CREATE OR REPLACE FUNCTION public.cast_ballot_tx(
  p_election_id uuid,
  p_voter_id uuid,
  p_ciphertext text,
  p_iv text,
  p_encrypted_key text,
  p_signature text,
  p_ballot_hash text,
  p_receipt_hash text,
  p_receipt_token text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- One-vote guard inside the transaction (eligible and not yet voted).
  IF NOT EXISTS (
    SELECT 1 FROM public.election_eligibility
    WHERE election_id = p_election_id
      AND voter_id = p_voter_id
      AND has_voted = false
  ) THEN
    RAISE EXCEPTION 'not_eligible_or_already_voted';
  END IF;

  INSERT INTO public.ballots
    (election_id, ciphertext, iv, encrypted_key, signature, ballot_hash)
  VALUES
    (p_election_id, p_ciphertext, p_iv, p_encrypted_key, p_signature, p_ballot_hash);

  UPDATE public.election_eligibility
  SET has_voted = true, voted_at = now()
  WHERE election_id = p_election_id AND voter_id = p_voter_id;

  INSERT INTO public.ballot_receipts
    (election_id, voter_id, ballot_hash, receipt_token)
  VALUES
    (p_election_id, p_voter_id, p_receipt_hash, p_receipt_token);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cast_ballot_tx(uuid, uuid, text, text, text, text, text, text, text) TO service_role;