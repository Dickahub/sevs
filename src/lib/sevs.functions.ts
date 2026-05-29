import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHash } from "crypto";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GENESIS = "0".repeat(64);

function sha256(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

// Append a tamper-evident entry to the SHA-256 hash-chained audit log.
async function appendAudit(actor: string, action: string, electionId: string | null) {
  const { data: last } = await supabaseAdmin
    .from("audit_log")
    .select("hash")
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();

  const prevHash = last?.hash ?? GENESIS;
  const ts = new Date().toISOString();
  const hash = sha256(`${prevHash}|${ts}|${actor}|${action}|${electionId ?? ""}`);

  await supabaseAdmin.from("audit_log").insert({
    ts,
    actor,
    action,
    election_id: electionId,
    prev_hash: prevHash,
    hash,
  });
}

const castSchema = z.object({
  electionId: z.string().uuid(),
  selections: z
    .array(
      z.object({
        positionId: z.string().uuid(),
        candidateIds: z.array(z.string().uuid()).max(10),
      }),
    )
    .min(1)
    .max(50),
});

export const castBallot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => castSchema.parse(input))
  .handler(async ({ data, context }) => {
    const voterId = context.userId;

    // 1. Election must exist and be open.
    const { data: election, error: elErr } = await supabaseAdmin
      .from("elections")
      .select("id, status, opens_at, closes_at")
      .eq("id", data.electionId)
      .single();
    if (elErr || !election) return { success: false as const, error: "Election not found." };
    if (election.status !== "open") return { success: false as const, error: "This election is not open for voting." };
    const nowMs = Date.now();
    if (nowMs < new Date(election.opens_at).getTime() || nowMs > new Date(election.closes_at).getTime()) {
      return { success: false as const, error: "Voting is closed for this election." };
    }

    // 2. One voter, one ballot.
    const { data: existing } = await supabaseAdmin
      .from("ballot_receipts")
      .select("id")
      .eq("election_id", data.electionId)
      .eq("voter_id", voterId)
      .maybeSingle();
    if (existing) return { success: false as const, error: "You have already voted in this election." };

    // 3. Validate positions & candidates and seat limits.
    const { data: positions } = await supabaseAdmin
      .from("positions")
      .select("id, seats, candidates(id)")
      .eq("election_id", data.electionId);
    const posMap = new Map((positions ?? []).map((p) => [p.id, p]));

    const voteRows: { election_id: string; position_id: string; candidate_id: string }[] = [];
    for (const sel of data.selections) {
      const pos = posMap.get(sel.positionId);
      if (!pos) return { success: false as const, error: "Invalid position in ballot." };
      if (sel.candidateIds.length > pos.seats) {
        return { success: false as const, error: "Too many candidates selected for a position." };
      }
      const validCandidates = new Set((pos.candidates as { id: string }[]).map((c) => c.id));
      const unique = new Set(sel.candidateIds);
      if (unique.size !== sel.candidateIds.length) {
        return { success: false as const, error: "Duplicate candidate selection." };
      }
      for (const cid of sel.candidateIds) {
        if (!validCandidates.has(cid)) return { success: false as const, error: "Invalid candidate in ballot." };
        voteRows.push({ election_id: data.electionId, position_id: sel.positionId, candidate_id: cid });
      }
    }

    // 4. Compute a verifiable receipt hash (does NOT reveal choices on-chain).
    const ballotHash = sha256(
      `${voterId}|${data.electionId}|${JSON.stringify(data.selections)}|${Date.now()}`,
    );

    // 5. Record the receipt FIRST (unique constraint is the real guard against
    //    double voting under concurrency).
    const { error: rcptErr } = await supabaseAdmin.from("ballot_receipts").insert({
      election_id: data.electionId,
      voter_id: voterId,
      ballot_hash: ballotHash,
    });
    if (rcptErr) {
      return { success: false as const, error: "You have already voted in this election." };
    }

    // 6. Store the anonymous votes (no voter link → ballot secrecy).
    if (voteRows.length > 0) {
      const { error: voteErr } = await supabaseAdmin.from("votes").insert(voteRows);
      if (voteErr) {
        // Roll back the receipt so the voter can retry.
        await supabaseAdmin
          .from("ballot_receipts")
          .delete()
          .eq("election_id", data.electionId)
          .eq("voter_id", voterId);
        return { success: false as const, error: "Failed to record ballot. Please try again." };
      }
    }

    await appendAudit("voter:#anon", "BALLOT_CAST", data.electionId);

    return { success: true as const, ballotHash, castAt: new Date().toISOString() };
  });

const electionIdSchema = z.object({ electionId: z.string().uuid() });

// Tallied results computed from the anonymous votes table (server-only access).
export const getResults = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => electionIdSchema.parse(input))
  .handler(async ({ data }) => {
    const { data: votes } = await supabaseAdmin
      .from("votes")
      .select("candidate_id")
      .eq("election_id", data.electionId);

    const counts: Record<string, number> = {};
    for (const v of votes ?? []) {
      counts[v.candidate_id] = (counts[v.candidate_id] ?? 0) + 1;
    }
    const { count: ballots } = await supabaseAdmin
      .from("ballot_receipts")
      .select("id", { count: "exact", head: true })
      .eq("election_id", data.electionId);

    return { counts, ballotsCast: ballots ?? 0 };
  });

// Live turnout (ballots cast) for any election — safe aggregate, no identities.
export const getTurnout = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => electionIdSchema.parse(input))
  .handler(async ({ data }) => {
    const { count } = await supabaseAdmin
      .from("ballot_receipts")
      .select("id", { count: "exact", head: true })
      .eq("election_id", data.electionId);
    return { ballotsCast: count ?? 0 };
  });

// Whether the current user has already voted in an election.
export const getMyBallotStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => electionIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: receipt } = await supabaseAdmin
      .from("ballot_receipts")
      .select("ballot_hash, cast_at")
      .eq("election_id", data.electionId)
      .eq("voter_id", context.userId)
      .maybeSingle();
    return { hasVoted: !!receipt, receipt: receipt ?? null };
  });
