import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { effectiveStatus } from "@/lib/sevs-types";
import { importElectionPrivateKey, decryptBallot, signMessage, sha256Hex } from "@/lib/sevs-crypto";
import {
  appendAudit,
  verifyChain,
  getSystemSigningKey,
  getSystemPublicKeyPem,
} from "@/lib/sevs-audit.server";

function serverSecret(): string {
  const s = process.env.SEVS_SERVER_SECRET;
  if (!s) throw new Error("Server signing secret is not configured.");
  return s;
}

async function requireAdmin(userId: string) {
  const { data } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  if (!(data ?? []).some((r) => r.role === "admin")) {
    throw new Error("Forbidden: administrator access required.");
  }
}

function actorTag(userId: string) {
  return `admin:#${userId.slice(0, 8)}`;
}

const electionIdSchema = z.object({ electionId: z.string().uuid() });

// ============================================================================
// Close & tally — decrypt every ballot with the election private key
// ============================================================================

export const closeAndTally = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ electionId: z.string().uuid(), passphrase: z.string().min(1).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);

    const { data: election } = await supabaseAdmin
      .from("elections")
      .select("id, opens_at, closes_at")
      .eq("id", data.electionId)
      .maybeSingle();
    if (!election) return { ok: false as const, error: "Election not found." };
    if (effectiveStatus(election.opens_at, election.closes_at) !== "closed") {
      return { ok: false as const, error: "The election must be closed before tallying." };
    }

    const { data: keyRow } = await supabaseAdmin
      .from("election_keys")
      .select("encrypted_private_key")
      .eq("election_id", data.electionId)
      .maybeSingle();
    if (!keyRow) return { ok: false as const, error: "Election decryption key not found." };

    let privateKey;
    try {
      privateKey = await importElectionPrivateKey(keyRow.encrypted_private_key, data.passphrase);
    } catch {
      return { ok: false as const, error: "Invalid election passphrase — cannot decrypt ballots." };
    }

    const { data: ballots } = await supabaseAdmin
      .from("ballots")
      .select("ciphertext, iv, encrypted_key")
      .eq("election_id", data.electionId);

    const counts: Record<string, number> = {};
    let decrypted = 0;
    for (const b of ballots ?? []) {
      try {
        const plaintext = await decryptBallot(privateKey, b);
        const parsed = JSON.parse(plaintext) as {
          selections: Array<{ positionId: string; candidateIds: string[] }>;
        };
        for (const sel of parsed.selections) {
          for (const cid of sel.candidateIds) counts[cid] = (counts[cid] ?? 0) + 1;
        }
        decrypted++;
      } catch {
        // A ballot that fails to decrypt is skipped but flagged in the audit detail.
      }
    }

    const totalBallots = (ballots ?? []).length;
    await supabaseAdmin
      .from("elections")
      .update({
        tally: { counts, totalBallots, decrypted },
        tallied_at: new Date().toISOString(),
        results_published: true,
        status: "closed",
      })
      .eq("id", data.electionId);

    await appendAudit(
      actorTag(context.userId),
      "RESULT_TALLY_COMPUTED",
      data.electionId,
      `ballots=${totalBallots} decrypted=${decrypted}`,
    );
    await appendAudit(actorTag(context.userId), "ELECTION_PUBLISHED", data.electionId, "");

    return { ok: true as const, totalBallots, decrypted };
  });

// ============================================================================
// Suspend / resume / publish toggles
// ============================================================================

export const setElectionSuspended = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ electionId: z.string().uuid(), suspended: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("elections")
      .update({ suspended: data.suspended })
      .eq("id", data.electionId);
    if (error) return { ok: false as const, error: error.message };
    await appendAudit(
      actorTag(context.userId),
      data.suspended ? "ELECTION_SUSPENDED" : "ELECTION_RESUMED",
      data.electionId,
      "",
    );
    return { ok: true as const };
  });

export const setResultsPublished = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ electionId: z.string().uuid(), published: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("elections")
      .update({ results_published: data.published })
      .eq("id", data.electionId);
    if (error) return { ok: false as const, error: error.message };
    await appendAudit(
      actorTag(context.userId),
      data.published ? "ELECTION_PUBLISHED" : "RESULTS_UNPUBLISHED",
      data.electionId,
      "",
    );
    return { ok: true as const };
  });

// ============================================================================
// Audit-log integrity verification
// ============================================================================

export const verifyAuditChain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    const result = await verifyChain();
    await appendAudit(
      actorTag(context.userId),
      "AUDIT_LOG_VERIFIED",
      null,
      result.valid ? `valid total=${result.total}` : `BROKEN at seq=${result.brokenAtSeq}`,
    );
    return result;
  });

// ============================================================================
// Result helpers (CSV/PDF) — shared loader
// ============================================================================

async function loadResultData(electionId: string) {
  const { data: e } = await supabaseAdmin
    .from("elections")
    .select("id, title, organisation, opens_at, closes_at, eligible_voters, results_published, tally, tallied_at")
    .eq("id", electionId)
    .maybeSingle();
  if (!e) return null;

  const { data: positions } = await supabaseAdmin
    .from("positions")
    .select("id, title, seats, sort_order, candidates(id, name, sort_order)")
    .eq("election_id", electionId)
    .order("sort_order", { ascending: true });

  const tally = e.tally as { counts?: Record<string, number> } | null;
  let counts: Record<string, number> = tally?.counts ?? {};
  if (Object.keys(counts).length === 0) {
    const { data: votes } = await supabaseAdmin
      .from("votes")
      .select("candidate_id")
      .eq("election_id", electionId);
    counts = {};
    for (const v of votes ?? []) counts[v.candidate_id] = (counts[v.candidate_id] ?? 0) + 1;
  }

  const { count: receiptCount } = await supabaseAdmin
    .from("ballot_receipts")
    .select("id", { count: "exact", head: true })
    .eq("election_id", electionId);

  const totalVotes = Object.values(counts).reduce((a, b) => a + b, 0);
  const maxSeats = Math.max(1, ...((positions ?? []).map((p) => p.seats)));
  const ballotsCast = receiptCount && receiptCount > 0 ? receiptCount : Math.round(totalVotes / maxSeats);
  const participationPct = e.eligible_voters > 0 ? Math.round((ballotsCast / e.eligible_voters) * 100) : 0;

  return {
    election: e,
    positions: (positions ?? []).map((p) => ({
      id: p.id,
      title: p.title,
      seats: p.seats,
      candidates: [...((p.candidates as Array<{ id: string; name: string; sort_order: number }>) ?? [])]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((c) => ({ id: c.id, name: c.name, votes: counts[c.id] ?? 0 })),
    })),
    eligibleVoters: e.eligible_voters,
    ballotsCast,
    participationPct,
  };
}

export const exportResultsCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => electionIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const r = await loadResultData(data.electionId);
    if (!r) return { ok: false as const, error: "Election not found." };

    const lines: string[] = [];
    lines.push(`Election,${JSON.stringify(r.election.title)}`);
    lines.push(`Organisation,${JSON.stringify(r.election.organisation)}`);
    lines.push(`Eligible voters,${r.eligibleVoters}`);
    lines.push(`Ballots cast,${r.ballotsCast}`);
    lines.push(`Participation rate,${r.participationPct}%`);
    lines.push("");
    lines.push("Position,Candidate,Votes,Percentage");
    for (const p of r.positions) {
      const total = p.candidates.reduce((a, c) => a + c.votes, 0) || 1;
      for (const c of p.candidates) {
        const pct = Math.round((c.votes / total) * 100);
        lines.push(`${JSON.stringify(p.title)},${JSON.stringify(c.name)},${c.votes},${pct}%`);
      }
    }
    const csv = lines.join("\n");

    await appendAudit(actorTag(context.userId), "RESULTS_EXPORTED", data.electionId, "format=csv");
    return {
      ok: true as const,
      filename: `results-${r.election.title.replace(/\s+/g, "_")}.csv`,
      mime: "text/csv",
      base64: Buffer.from(csv, "utf8").toString("base64"),
    };
  });

export const exportResultsPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => electionIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const r = await loadResultData(data.electionId);
    if (!r) return { ok: false as const, error: "Election not found." };

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    let page = pdf.addPage([595, 842]);
    let y = 800;
    const draw = (text: string, size = 11, f = font, color = rgb(0.1, 0.1, 0.12)) => {
      if (y < 50) {
        page = pdf.addPage([595, 842]);
        y = 800;
      }
      page.drawText(text, { x: 50, y, size, font: f, color });
      y -= size + 6;
    };

    draw("SEVS — Election Results Report", 18, bold);
    draw(r.election.title, 13, bold);
    draw(r.election.organisation, 11);
    draw(`Generated: ${new Date().toISOString()}`, 9, font, rgb(0.4, 0.4, 0.45));
    y -= 8;
    draw(`Total eligible voters: ${r.eligibleVoters}`, 11);
    draw(`Total ballots cast: ${r.ballotsCast}`, 11);
    draw(`Participation rate: ${r.participationPct}%`, 11);
    y -= 8;

    for (const p of r.positions) {
      draw(p.title, 13, bold);
      const total = p.candidates.reduce((a, c) => a + c.votes, 0) || 1;
      for (const c of p.candidates) {
        const pct = Math.round((c.votes / total) * 100);
        draw(`   ${c.name} — ${c.votes} votes (${pct}%)`, 11);
      }
      y -= 6;
    }

    const bytes = await pdf.save();
    await appendAudit(actorTag(context.userId), "RESULTS_EXPORTED", data.electionId, "format=pdf");
    return {
      ok: true as const,
      filename: `results-${r.election.title.replace(/\s+/g, "_")}.pdf`,
      mime: "application/pdf",
      base64: Buffer.from(bytes).toString("base64"),
    };
  });

// ============================================================================
// Signed audit-log PDF export
// ============================================================================

export const exportAuditPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ electionId: z.string().uuid().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);

    let query = supabaseAdmin
      .from("audit_log")
      .select("seq, ts, actor, action, election_id, prev_hash, hash, details")
      .order("seq", { ascending: true });
    if (data.electionId) query = query.eq("election_id", data.electionId);
    const { data: rows } = await query;
    const entries = rows ?? [];

    // Canonical text of the report content — this is what we sign.
    const canonical = entries
      .map((r) => `${r.seq}|${r.ts}|${r.actor}|${r.action}|${r.election_id ?? ""}|${r.details ?? ""}|${r.hash}`)
      .join("\n");
    const contentHash = sha256Hex(canonical);
    const { privateKey, publicKeyPem } = await getSystemSigningKey(serverSecret());
    const signature = await signMessage(privateKey, contentHash);

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const mono = await pdf.embedFont(StandardFonts.Courier);
    let page = pdf.addPage([595, 842]);
    let y = 800;
    const draw = (text: string, size = 9, f = font, color = rgb(0.1, 0.1, 0.12)) => {
      if (y < 50) {
        page = pdf.addPage([595, 842]);
        y = 800;
      }
      page.drawText(text.slice(0, 110), { x: 40, y, size, font: f, color });
      y -= size + 4;
    };

    draw("SEVS — Tamper-Evident Audit Log (Signed Report)", 16, bold);
    draw(`Generated: ${new Date().toISOString()}`, 9, font, rgb(0.4, 0.4, 0.45));
    draw(`Entries: ${entries.length}`, 9);
    y -= 6;
    for (const r of entries) {
      draw(`#${r.seq}  ${r.ts}  ${r.actor}`, 9, bold);
      draw(`   ${r.action}  ${r.details ?? ""}`, 9);
      draw(`   hash: ${r.hash}`, 8, mono, rgb(0.35, 0.35, 0.4));
    }

    y -= 10;
    draw("DIGITAL SIGNATURE (RSA-SHA256)", 11, bold);
    draw(`Content SHA-256: ${contentHash}`, 8, mono);
    for (let i = 0; i < signature.length; i += 100) draw(signature.slice(i, i + 100), 7, mono);
    y -= 6;
    draw("Verification public key (PEM):", 9, bold);
    for (const ln of publicKeyPem.trim().split("\n")) draw(ln, 7, mono);

    const bytes = await pdf.save();
    await appendAudit(actorTag(context.userId), "AUDIT_LOG_EXPORTED", data.electionId ?? null, "format=pdf signed");
    return {
      ok: true as const,
      filename: `audit-log-signed.pdf`,
      mime: "application/pdf",
      base64: Buffer.from(bytes).toString("base64"),
      signature,
      contentHash,
      publicKeyPem,
    };
  });

export const getAuditPublicKey = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    return { publicKeyPem: await getSystemPublicKeyPem() };
  });
