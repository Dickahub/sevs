// Server-only audit log helper. Every security-relevant event is appended as an
// immutable, SHA-256 hash-chained entry. The database also blocks UPDATE/DELETE
// at the row level, so the chain is append-only end to end.

import { createHash } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const AUDIT_GENESIS = "0".repeat(64);

export function sha256(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

// Canonical serialisation of an entry's content for hashing.
export function auditCanonical(
  prevHash: string,
  ts: string,
  actor: string,
  action: string,
  details: string,
  electionId: string | null,
) {
  return `${prevHash}|${ts}|${actor}|${action}|${details}|${electionId ?? ""}`;
}

// Append a tamper-evident entry. `actor` is the user id who triggered the event
// (or "SYSTEM" for automated events). `details` is a human-readable string that
// MUST NOT contain ballot content — only hash references where relevant.
export async function appendAudit(
  actor: string,
  action: string,
  details: string,
  electionId: string | null,
) {
  const { data: last } = await supabaseAdmin
    .from("audit_log")
    .select("hash")
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();

  const prevHash = last?.hash ?? AUDIT_GENESIS;
  const ts = new Date().toISOString();
  const hash = sha256(auditCanonical(prevHash, ts, actor, action, details, electionId));

  await supabaseAdmin.from("audit_log").insert({
    ts,
    actor,
    action,
    details,
    election_id: electionId,
    prev_hash: prevHash,
    hash,
  });
}
