// Server-only helpers for the tamper-evident audit log and the app-wide signing
// key. Imported by *.functions.ts handlers (the `.server` filename keeps it out
// of client bundles), mirroring how `client.server` is used elsewhere.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  GENESIS,
  auditHash,
  generateSigningKey,
  importSigningPrivateKey,
} from "@/lib/sevs-crypto";

// Append a tamper-evident entry to the SHA-256 hash-chained audit log. `details`
// is part of the hashed content. Use actor "SYSTEM" for automated events.
export async function appendAudit(
  actor: string,
  action: string,
  electionId: string | null = null,
  details = "",
): Promise<void> {
  const { data: last } = await supabaseAdmin
    .from("audit_log")
    .select("hash")
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();

  const prevHash = last?.hash ?? GENESIS;
  const ts = new Date().toISOString();
  const hash = auditHash(prevHash, ts, actor, action, electionId, details);

  await supabaseAdmin.from("audit_log").insert({
    ts,
    actor,
    action,
    election_id: electionId,
    prev_hash: prevHash,
    hash,
    details: details || null,
  });
}

// Recompute and validate the entire hash chain. Returns the first broken seq, if
// any. A clean chain proves no entry was altered, inserted, or removed.
export async function verifyChain() {
  const { data } = await supabaseAdmin
    .from("audit_log")
    .select("seq, ts, actor, action, election_id, prev_hash, hash, details")
    .order("seq", { ascending: true });

  const rows = data ?? [];
  let prev = GENESIS;
  for (const r of rows) {
    const expected = auditHash(prev, r.ts, r.actor, r.action, r.election_id, r.details ?? "");
    if (r.prev_hash !== prev || r.hash !== expected) {
      return { valid: false as const, brokenAtSeq: Number(r.seq), total: rows.length };
    }
    prev = r.hash;
  }
  return { valid: true as const, brokenAtSeq: null, total: rows.length };
}

// Get-or-create the singleton app signing key. The private key is wrapped with
// the server secret; the public key is published for verification.
export async function getSystemSigningKey(secret: string) {
  const generated = await generateSigningKey(secret);
  // Insert only if missing — concurrent callers keep the first key written.
  await supabaseAdmin.from("system_keys").upsert(
    {
      id: true,
      signing_public_key: generated.publicKeyPem,
      signing_private_key: generated.wrappedPrivateKey,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );

  const { data: row } = await supabaseAdmin
    .from("system_keys")
    .select("signing_public_key, signing_private_key")
    .eq("id", true)
    .maybeSingle();

  const publicKeyPem = row?.signing_public_key ?? generated.publicKeyPem;
  const wrapped = row?.signing_private_key ?? generated.wrappedPrivateKey;
  return { publicKeyPem, privateKey: await importSigningPrivateKey(wrapped, secret) };
}

// Public verification key for the app signing key (no secret needed).
export async function getSystemPublicKeyPem(): Promise<string | null> {
  const { data: row } = await supabaseAdmin
    .from("system_keys")
    .select("signing_public_key")
    .eq("id", true)
    .maybeSingle();
  return row?.signing_public_key ?? null;
}
