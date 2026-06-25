import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { effectiveStatus } from "@/lib/sevs-types";
import { issueBallotSession } from "@/lib/sevs-crypto";

// ---- helpers ----------------------------------------------------------------

function serverSecret(): string {
  const s = process.env.SEVS_SERVER_SECRET;
  if (!s) throw new Error("Server signing secret is not configured.");
  return s;
}

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

interface ElectionRow {
  id: string;
  title: string;
  organisation: string;
  status: string;
  opens_at: string;
  closes_at: string;
  eligible_voters: number;
  suspended?: boolean;
}

function normalizeElection(e: ElectionRow, ballotsCast: number) {
  return {
    id: e.id,
    title: e.title,
    organisation: e.organisation,
    status: effectiveStatus(e.opens_at, e.closes_at),
    opensAt: e.opens_at,
    closesAt: e.closes_at,
    eligibleVoters: e.eligible_voters,
    ballotsCast,
    suspended: !!e.suspended,
  };
}

async function ballotCounts(): Promise<Record<string, number>> {
  const { data } = await supabaseAdmin.from("ballot_receipts").select("election_id");
  const counts: Record<string, number> = {};
  for (const r of data ?? []) counts[r.election_id] = (counts[r.election_id] ?? 0) + 1;
  return counts;
}

async function loadPositions(electionId: string) {
  const { data } = await supabaseAdmin
    .from("positions")
    .select("id, title, seats, sort_order, candidates(id, name, programme, statement, sort_order)")
    .eq("election_id", electionId)
    .order("sort_order", { ascending: true });

  return (data ?? []).map((p) => ({
    id: p.id,
    title: p.title,
    seats: p.seats,
    candidates: [...((p.candidates as Array<{ id: string; name: string; programme: string | null; statement: string | null; sort_order: number }>) ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((c) => ({
        id: c.id,
        name: c.name,
        programme: c.programme ?? "",
        statement: c.statement ?? "",
        initials: initials(c.name),
      })),
  }));
}

async function isAdmin(userId: string) {
  const { data } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  return (data ?? []).some((r) => r.role === "admin");
}

const electionIdSchema = z.object({ electionId: z.string().uuid() });

// ---- current user -----------------------------------------------------------

export const getMe = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, student_id, is_active")
      .eq("id", context.userId)
      .maybeSingle();
    return {
      userId: context.userId,
      fullName: profile?.full_name ?? null,
      studentId: profile?.student_id ?? null,
      isActive: profile?.is_active ?? true,
      isAdmin: await isAdmin(context.userId),
    };
  });

// ---- elections list ---------------------------------------------------------

export const getElections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: elections } = await supabaseAdmin
      .from("elections")
      .select("id, title, organisation, status, opens_at, closes_at, eligible_voters, suspended")
      .order("created_at", { ascending: true });
    const counts = await ballotCounts();
    let rows = (elections ?? []).map((e) => normalizeElection(e, counts[e.id] ?? 0));

    if (!(await isAdmin(context.userId))) {
      const { data: myElig } = await supabaseAdmin
        .from("election_eligibility")
        .select("election_id")
        .eq("voter_id", context.userId);
      const allowed = new Set((myElig ?? []).map((r) => r.election_id));
      rows = rows.filter((e) => allowed.has(e.id));
    }

    return { elections: rows };
  });

// ---- election detail (ballot) ----------------------------------------------

export const getElectionDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => electionIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: e } = await supabaseAdmin
      .from("elections")
      .select("id, title, organisation, status, opens_at, closes_at, eligible_voters, suspended")
      .eq("id", data.electionId)
      .maybeSingle();
    if (!e) {
      return { election: null, positions: [], hasVoted: false, receipt: null, eligible: false, sessionToken: null, sessionExpiresAt: null };
    }

    const counts = await ballotCounts();
    const positions = await loadPositions(data.electionId);

    const { data: receipt } = await supabaseAdmin
      .from("ballot_receipts")
      .select("ballot_hash, cast_at, receipt_token")
      .eq("election_id", data.electionId)
      .eq("voter_id", context.userId)
      .maybeSingle();

    const { data: elig } = await supabaseAdmin
      .from("election_eligibility")
      .select("has_voted")
      .eq("election_id", data.electionId)
      .eq("voter_id", context.userId)
      .maybeSingle();

    const hasVoted = !!receipt || !!elig?.has_voted;
    const status = effectiveStatus(e.opens_at, e.closes_at);
    const canVote = !!elig && !hasVoted && status === "open" && !e.suspended;

    // Issue a 20-minute ballot session only when the ballot is actually votable.
    let sessionToken: string | null = null;
    let sessionExpiresAt: string | null = null;
    if (canVote) {
      sessionToken = issueBallotSession(data.electionId, context.userId, serverSecret());
      sessionExpiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    }

    return {
      election: normalizeElection(e, counts[data.electionId] ?? 0),
      positions,
      hasVoted,
      receipt: receipt ?? null,
      eligible: !!elig,
      sessionToken,
      sessionExpiresAt,
    };
  });

// ---- election results -------------------------------------------------------

export const getElectionResults = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => electionIdSchema.parse(input))
  .handler(async ({ data }) => {
    const { data: e } = await supabaseAdmin
      .from("elections")
      .select("id, title, organisation, status, opens_at, closes_at, eligible_voters, suspended, results_published, tally, tallied_at")
      .eq("id", data.electionId)
      .maybeSingle();
    if (!e) {
      return { election: null, sealed: false, positions: [], counts: {}, ballotsCast: 0, totalVotes: 0, eligibleVoters: 0, participationPct: 0, resultsPublished: false, talliedAt: null };
    }

    const status = effectiveStatus(e.opens_at, e.closes_at);
    const allowed = status === "closed" || e.results_published === true;
    const positions = await loadPositions(data.electionId);

    // Gate: never expose counts (even partial) while an election is open/draft.
    if (!allowed) {
      return {
        election: normalizeElection(e, 0),
        sealed: true as const,
        positions,
        counts: {},
        ballotsCast: 0,
        totalVotes: 0,
        eligibleVoters: e.eligible_voters,
        participationPct: 0,
        resultsPublished: false,
        talliedAt: null,
      };
    }

    // Prefer the stored aggregate (computed by decrypting ballots at close).
    let counts: Record<string, number> = {};
    const tally = e.tally as { counts?: Record<string, number> } | null;
    if (tally?.counts && Object.keys(tally.counts).length > 0) {
      counts = tally.counts;
    } else {
      // Legacy fallback: aggregate the anonymous votes table.
      const { data: votes } = await supabaseAdmin
        .from("votes")
        .select("candidate_id")
        .eq("election_id", data.electionId);
      for (const v of votes ?? []) counts[v.candidate_id] = (counts[v.candidate_id] ?? 0) + 1;
    }

    const totalVotes = Object.values(counts).reduce((a, b) => a + b, 0);

    const { count: receiptCount } = await supabaseAdmin
      .from("ballot_receipts")
      .select("id", { count: "exact", head: true })
      .eq("election_id", data.electionId);
    const maxSeats = Math.max(1, ...positions.map((p) => p.seats));
    const ballotsCast = receiptCount && receiptCount > 0 ? receiptCount : Math.round(totalVotes / maxSeats);

    const eligibleVoters = e.eligible_voters;
    const participationPct = eligibleVoters > 0 ? Math.round((ballotsCast / eligibleVoters) * 100) : 0;

    return {
      election: normalizeElection(e, ballotsCast),
      sealed: false as const,
      positions,
      counts,
      ballotsCast,
      totalVotes,
      eligibleVoters,
      participationPct,
      resultsPublished: e.results_published === true,
      talliedAt: e.tallied_at,
    };
  });

// ---- audit log --------------------------------------------------------------

export const getAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data } = await supabaseAdmin
      .from("audit_log")
      .select("seq, ts, actor, action, election_id, prev_hash, hash, details")
      .order("seq", { ascending: true });
    return {
      entries: (data ?? []).map((r) => ({
        seq: Number(r.seq),
        ts: r.ts,
        actor: r.actor,
        action: r.action,
        electionId: r.election_id,
        prevHash: r.prev_hash,
        hash: r.hash,
        details: r.details ?? "",
      })),
    };
  });

// ---- admin overview ---------------------------------------------------------

export const getAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!(await isAdmin(context.userId))) {
      throw new Error("Forbidden: administrator access required.");
    }

    const { data: elections } = await supabaseAdmin
      .from("elections")
      .select("id, title, organisation, status, opens_at, closes_at, eligible_voters, suspended")
      .order("created_at", { ascending: true });
    const counts = await ballotCounts();
    const rows = (elections ?? []).map((e) => normalizeElection(e, counts[e.id] ?? 0));

    const { count: voterCount } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true });
    const { count: auditCount } = await supabaseAdmin
      .from("audit_log")
      .select("seq", { count: "exact", head: true });

    return {
      elections: rows,
      totalEligible: rows.reduce((a, e) => a + e.eligibleVoters, 0),
      totalBallots: rows.reduce((a, e) => a + e.ballotsCast, 0),
      registeredVoters: voterCount ?? 0,
      auditCount: auditCount ?? 0,
    };
  });
