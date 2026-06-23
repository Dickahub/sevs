import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHash } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GENESIS = "0".repeat(64);

function sha256(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

async function appendAudit(actor: string, action: string) {
  const { data: last } = await supabaseAdmin
    .from("audit_log")
    .select("hash")
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  const prevHash = last?.hash ?? GENESIS;
  const ts = new Date().toISOString();
  const hash = sha256(`${prevHash}|${ts}|${actor}|${action}|`);
  await supabaseAdmin.from("audit_log").insert({
    ts,
    actor,
    action,
    election_id: null,
    prev_hash: prevHash,
    hash,
  });
}

async function resolveToken(token: string) {
  const { data: row } = await supabaseAdmin
    .from("voter_setup_tokens")
    .select("id, voter_id, expires_at, used_at")
    .eq("token_hash", sha256(token))
    .maybeSingle();
  if (!row) return { state: "invalid" as const };
  if (row.used_at) return { state: "used" as const };
  if (new Date(row.expires_at).getTime() < Date.now()) return { state: "expired" as const };
  return { state: "valid" as const, row };
}

// Public: validate a setup token and return the associated account email.
export const validateSetupToken = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ token: z.string().min(10).max(200) }).parse(input))
  .handler(async ({ data }) => {
    const res = await resolveToken(data.token);
    if (res.state !== "valid") return { valid: false as const, reason: res.state };
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, email, is_active")
      .eq("id", res.row.voter_id)
      .maybeSingle();
    if (profile && profile.is_active === false) {
      return { valid: false as const, reason: "inactive" as const };
    }
    return {
      valid: true as const,
      email: profile?.email ?? null,
      fullName: profile?.full_name ?? null,
    };
  });

// Public: set the account password using a valid one-time token, then burn it.
export const completeSetup = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        token: z.string().min(10).max(200),
        password: z.string().min(8).max(128),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const res = await resolveToken(data.token);
    if (res.state !== "valid") {
      return { ok: false as const, error: "This setup link is no longer valid." };
    }

    const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(res.row.voter_id, {
      password: data.password,
    });
    if (pwErr) return { ok: false as const, error: "Could not set your password. Please try again." };

    await supabaseAdmin
      .from("voter_setup_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("id", res.row.id);

    await appendAudit(`voter:#${res.row.voter_id.slice(0, 8)}`, "ACCOUNT_SETUP_COMPLETED");
    return { ok: true as const };
  });
