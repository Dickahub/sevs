-- 1. audit_log: restrict SELECT to admins only (was readable by all authenticated users)
DROP POLICY IF EXISTS "Authenticated users can view audit log" ON public.audit_log;
CREATE POLICY "Admins can view audit log"
ON public.audit_log
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 2. election_eligibility: restrict SELECT to admins only (removes participation-status exposure to voters)
DROP POLICY IF EXISTS "View own eligibility or admin" ON public.election_eligibility;
CREATE POLICY "Admins can view eligibility"
ON public.election_eligibility
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 3. user_roles: restrict SELECT to admins only (removes self role enumeration; has_role is SECURITY DEFINER and unaffected)
DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;
CREATE POLICY "Admins can view roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));