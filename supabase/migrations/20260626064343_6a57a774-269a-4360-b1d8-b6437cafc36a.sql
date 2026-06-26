-- 1) elections: stop exposing sensitive columns (tally, suspended) to clients.
-- All application reads use the service role, which bypasses these grants.
REVOKE SELECT ON public.elections FROM authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.elections FROM anon;
GRANT SELECT (
  id, title, organisation, description, status, opens_at, closes_at,
  eligible_voters, created_at, public_key, results_published, tallied_at
) ON public.elections TO authenticated;
GRANT ALL ON public.elections TO service_role;

-- 2) user_roles: remove any client write access so authenticated users
-- cannot grant themselves a role. Role changes happen only via the service
-- role (admin server functions). Admins can still read via existing policy.
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.user_roles FROM anon;
GRANT ALL ON public.user_roles TO service_role;

-- Explicit restrictive guard: deny all writes to user_roles for the
-- authenticated role even if a permissive policy is ever added.
DROP POLICY IF EXISTS "No client writes to user_roles" ON public.user_roles;
CREATE POLICY "No client writes to user_roles"
  ON public.user_roles
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);