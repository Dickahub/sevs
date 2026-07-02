-- Hide the candidate→voter linkage from non-admin clients (column-level).
-- All application reads go through the service-role client, which is unaffected.
REVOKE SELECT ON public.candidates FROM authenticated;
GRANT SELECT (id, position_id, name, programme, statement, sort_order, bio) ON public.candidates TO authenticated;

-- Let voters verify their own eligibility and voting status (own rows only).
GRANT SELECT ON public.election_eligibility TO authenticated;
DROP POLICY IF EXISTS "Voters can view their own eligibility" ON public.election_eligibility;
CREATE POLICY "Voters can view their own eligibility"
  ON public.election_eligibility
  FOR SELECT
  TO authenticated
  USING (voter_id = auth.uid());