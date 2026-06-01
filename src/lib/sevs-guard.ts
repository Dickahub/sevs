import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

// Route guard: awaits the Supabase session restore (and revalidates the JWT),
// redirecting to /login when there is no authenticated user. Use from a
// route's `beforeLoad` so the bearer token is attached before loaders run.
export async function requireAuth() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw redirect({ to: "/login" });
  }
}
