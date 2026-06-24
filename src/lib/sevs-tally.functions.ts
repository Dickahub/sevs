import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { appendAudit, sha256, auditCanonical, AUDIT_GENESIS } from "@/lib/sevs-audit.server";
import {
  unlockElectionPrivateKey,
  hybridDecrypt,
  signData,
  verifyData,
} from "@/lib/sevs-crypto.server";
import { effectiveStatus } from "@/lib/sevs-types";

async function requireAdmin(userId: string) {
  const { data } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  if (!(data ?? []).some((r) => r.role === "admin")) {
    throw new Error("Forbidden: administrator access required.");
  }
}

function actorTag(userId: string) {
  return `admin:#${userId.slice(0, 8)}`;
}

interface StoredTally {
  perCandidate: Record<string, number>;
  perPositionTotals: Record<string, number>;
  decrypted: number;
  invalid: number;
  computedAt: string;
}

// REQ-RESULT: when the election closes, decrypt every ballot with the election
// private key (administrator passphrase), tally per candidate, store aggregate.
export const closeAndTally = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ electionId: z.string().uuid(), passphrase: z.string().min(1).max(500) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);

    const { data: election } = await supabaseAdmin
      .from("elections")
      .select("id, opens_at, closes_at")
      .eq("id", data.electionId)
      .maybeSingle();
    if (!election) return { ok: false as const, error: "Election not found." };

    // Tally is only permitted once the election has closed.
    if (effectiveStatus(election.opens_at, election.closes_at) !== "closed") {
      return { ok: false as const, error: "This election is still open. Results can only be tallied after it closes." };
    }

    const { data: keyRow } = await supabaseAdmin
      .from("election_keys")
      .select("encrypted_private_key")
      .eq("election_id", data.electionId)
      .maybeSingle();
    if (!keyRow) return { ok: false as const, error: "Election private key not found." };

    let privateKey: CryptoKey;
    try {
      privateKey = await unlockElectionPrivateKey(keyRow.encrypted_private_key, data.passphrase);
    } catch {
      return { ok: false as const, error: "Incorrect passphrase — could not unlock the private key." };
    }

    const { data: ballots } = await supabaseAdmin
      .from("ballots")
      .select("ciphertext, iv, encrypted_key, signature, ballot_hash")
      .eq("election_id", data.electionId);

    const perCandidate: Record<string, number> = {};
    const perPositionTotals: Record<string, number> = {};
    let decrypted = 0;
    let invalid = 0;

    for (const b of ballots ?? []) {
      try {
        const plaintext = await hybridDecrypt(
          { ciphertext: b.ciphertext, iv: b.iv, encryptedKey: b.encrypted_key },
          privateKey,
        );
        // Integrity: content hash + RSA-SHA256 signature must verify.
        if (sha256(plaintext) !== b.ballot_hash || !(await verifyData(b.ballot_hash, b.signature))) {
          invalid++;
          continue;
        }
        const parsed = JSON.parse(plaintext) as {
          selections: { positionId: string; candidateIds: string[] }[];
        };
        for (const sel of parsed.selections) {
          for (const cid of sel.candidateIds) {
            perCandidate[cid] = (perCandidate[cid] ?? 0) + 1;
            perPositionTotals[sel.positionId] = (perPositionTotals[sel.positionId] ?? 0) + 1;
          }
        }
        decrypted++;
      } catch {
        invalid++;
      }
    }

    const tally: StoredTally = {
      perCandidate,
      perPositionTotals,
      decrypted,
      invalid,
      computedAt: new Date().toISOString(),
    };

    await supabaseAdmin
      .from("elections")
      .update({ tally: JSON.parse(JSON.stringify(tally)), tallied_at: tally.computedAt })
      .eq("id", data.electionId);

    await appendAudit(
      actorTag(context.userId),
      "RESULT_TALLY_COMPUTED",
      `ballots=${decrypted}; invalid=${invalid}`,
      data.electionId,
    );

    return { ok: true as const, decrypted, invalid };
  });

// REQ-RESULT: publish results (enables the live results page + SSE stream).
export const publishResults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ electionId: z.string().uuid(), published: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { data: election } = await supabaseAdmin
      .from("elections")
      .select("tally")
      .eq("id", data.electionId)
      .maybeSingle();
    if (!election) return { ok: false as const, error: "Election not found." };
    if (data.published && !election.tally) {
      return { ok: false as const, error: "Tally the results before publishing." };
    }
    await supabaseAdmin
      .from("elections")
      .update({ results_published: data.published })
      .eq("id", data.electionId);
    await appendAudit(
      actorTag(context.userId),
      data.published ? "ELECTION_PUBLISHED" : "ELECTION_UNPUBLISHED",
      "",
      data.electionId,
    );
    return { ok: true as const };
  });

// REQ-RESULT: export results as CSV (admin only).
export const exportResultsCsv = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ electionId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);

    const { data: election } = await supabaseAdmin
      .from("elections")
      .select("title, organisation, eligible_voters, tally")
      .eq("id", data.electionId)
      .maybeSingle();
    if (!election) return { ok: false as const, error: "Election not found." };
    const tally = (election.tally as unknown as StoredTally | null) ?? null;
    if (!tally) return { ok: false as const, error: "Results have not been tallied yet." };

    const { data: positions } = await supabaseAdmin
      .from("positions")
      .select("id, title, seats, sort_order, candidates(id, name, sort_order)")
      .eq("election_id", data.electionId)
      .order("sort_order", { ascending: true });

    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const rows: string[] = ["Position,Candidate,Votes,Percentage"];
    for (const p of positions ?? []) {
      const total = tally.perPositionTotals[p.id] ?? 0;
      const cands = [...((p.candidates as Array<{ id: string; name: string; sort_order: number }>) ?? [])].sort(
        (a, b) => a.sort_order - b.sort_order,
      );
      for (const c of cands) {
        const votes = tally.perCandidate[c.id] ?? 0;
        const pct = total ? ((votes / total) * 100).toFixed(1) : "0.0";
        rows.push(`${esc(p.title)},${esc(c.name)},${votes},${pct}%`);
      }
    }
    const ballotsCast = tally.decrypted;
    const participation = election.eligible_voters
      ? ((ballotsCast / election.eligible_voters) * 100).toFixed(1)
      : "0.0";
    rows.push("");
    rows.push(`${esc("Eligible voters")},${election.eligible_voters}`);
    rows.push(`${esc("Ballots cast")},${ballotsCast}`);
    rows.push(`${esc("Participation rate")},${participation}%`);

    await appendAudit(actorTag(context.userId), "RESULTS_EXPORTED", "format=CSV", data.electionId);

    return {
      ok: true as const,
      filename: `results-${election.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`,
      csv: rows.join("\n"),
    };
  });

// REQ-AUDIT: recompute and validate the entire hash chain (admin only).
export const verifyAuditChain = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    const { data } = await supabaseAdmin
      .from("audit_log")
      .select("seq, ts, actor, action, details, election_id, prev_hash, hash")
      .order("seq", { ascending: true });

    const entries = data ?? [];
    let prev = AUDIT_GENESIS;
    let valid = true;
    let brokenAt: number | null = null;

    for (const e of entries) {
      const recomputed = sha256(
        auditCanonical(e.prev_hash, e.ts, e.actor, e.action, e.details ?? "", e.election_id),
      );
      if (e.prev_hash !== prev || recomputed !== e.hash) {
        valid = false;
        brokenAt = Number(e.seq);
        break;
      }
      prev = e.hash;
    }

    await appendAudit(actorTag(context.userId), "AUDIT_VERIFIED", `valid=${valid}; entries=${entries.length}`, null);
    return { valid, brokenAt, total: entries.length };
  });

// REQ-AUDIT: export the (optionally filtered) audit log with a report signature
// recipients can verify. Returns rows + an RSA-SHA256 signature over the report.
export const exportAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ electionId: z.string().uuid().nullable().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    let query = supabaseAdmin
      .from("audit_log")
      .select("seq, ts, actor, action, details, election_id, prev_hash, hash")
      .order("seq", { ascending: true });
    if (data?.electionId) query = query.eq("election_id", data.electionId);
    const { data: rows } = await query;
    const entries = (rows ?? []).map((r) => ({
      seq: Number(r.seq),
      ts: r.ts,
      actor: r.actor,
      action: r.action,
      details: r.details ?? "",
      electionId: r.election_id,
      hash: r.hash,
    }));

    const reportBody = JSON.stringify(entries);
    const reportHash = sha256(reportBody);
    const signature = await signData(reportHash);

    await appendAudit(actorTag(context.userId), "AUDIT_EXPORTED", `entries=${entries.length}`, data?.electionId ?? null);

    return { entries, reportHash, signature, signedAt: new Date().toISOString() };
  });
