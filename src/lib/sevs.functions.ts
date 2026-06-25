import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  sha256Hex,
  randomToken,
  verifyBallotSession,
  encryptBallot,
  signMessage,
} from "@/lib/sevs-crypto";
import { appendAudit, getSystemSigningKey } from "@/lib/sevs-audit.server";

// A delivered ballot must be submitted within this window or the voter must
// re-authenticate (REQ: 20-minute ballot session).
const BALLOT_SESSION_MS = 20 * 60 * 1000;

function serverSecret(): string {
  const s = process.env.SEVS_SERVER_SECRET;
  if (!s) throw new Error("Server signing secret is not configured.");
  return s;
}

const castSchema = z.object({
  electionId: z.string().uuid(),
  sessionToken: z.string().min(10).max(400),
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
    const secret = serverSecret();

    // 0. Ballot session must be valid and within the 20-minute window.
    const session = verifyBallotSession(
      data.sessionToken,
      data.electionId,
      voterId,
      secret,
      BALLOT_SESSION_MS,
    );
    if (!session.ok) {
      return {
        success: false as const,
        expired: session.reason === "expired",
        error:
          session.reason === "expired"
            ? "Your ballot session expired (20-minute limit). Please sign in again."
            : "Invalid ballot session. Please reopen the ballot.",
      };
    }

    // 1. Account must be active.
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("is_active")
      .eq("id", voterId)
      .maybeSingle();
    if (prof && prof.is_active === false) {
      return { success: false as const, error: "Your account is inactive. Contact an administrator." };
    }

    // 2. Election must exist, not be suspended, and be inside its voting window.
    const { data: election, error: elErr } = await supabaseAdmin
      .from("elections")
      .select("id, opens_at, closes_at, suspended, public_key")
      .eq("id", data.electionId)
      .single();
    if (elErr || !election) return { success: false as const, error: "Election not found." };
    if (election.suspended) {
      return { success: false as const, error: "Voting for this election has been suspended." };
    }
    const nowMs = Date.now();
    if (nowMs < new Date(election.opens_at).getTime()) {
      return { success: false as const, error: "This election has not opened yet." };
    }
    if (nowMs > new Date(election.closes_at).getTime()) {
      return { success: false as const, error: "Voting is closed for this election." };
    }
    if (!election.public_key) {
      return { success: false as const, error: "This election is not configured for encrypted voting." };
    }

    // 3. Voter must be eligible (the only voter↔ballot link is has_voted).
    const { data: elig } = await supabaseAdmin
      .from("election_eligibility")
      .select("id, has_voted")
      .eq("election_id", data.electionId)
      .eq("voter_id", voterId)
      .maybeSingle();
    if (!elig) {
      return { success: false as const, error: "You are not eligible to vote in this election." };
    }
    if (elig.has_voted) {
      return { success: false as const, error: "You have already voted in this election." };
    }

    // 4. Validate positions, candidates, seat limits.
    const { data: positions } = await supabaseAdmin
      .from("positions")
      .select("id, seats, candidates(id)")
      .eq("election_id", data.electionId);
    const posMap = new Map((positions ?? []).map((p) => [p.id, p]));

    for (const sel of data.selections) {
      const pos = posMap.get(sel.positionId);
      if (!pos) return { success: false as const, error: "Invalid position in ballot." };
      if (sel.candidateIds.length > pos.seats) {
        return { success: false as const, error: "Too many candidates selected for a position." };
      }
      const valid = new Set((pos.candidates as { id: string }[]).map((c) => c.id));
      const unique = new Set(sel.candidateIds);
      if (unique.size !== sel.candidateIds.length) {
        return { success: false as const, error: "Duplicate candidate selection." };
      }
      for (const cid of sel.candidateIds) {
        if (!valid.has(cid)) return { success: false as const, error: "Invalid candidate in ballot." };
      }
    }

    // 5. Hybrid-encrypt the ballot content with the election RSA public key.
    const plaintext = JSON.stringify({ selections: data.selections, castAt: new Date().toISOString() });
    const encrypted = await encryptBallot(election.public_key, plaintext);

    // 6. Hash the ciphertext and sign it (RSA-SHA256) for integrity.
    const ballotHash = sha256Hex(encrypted.ciphertext);
    const { privateKey } = await getSystemSigningKey(secret);
    const signature = await signMessage(privateKey, ballotHash);

    // 7. Opaque receipt token — verifies recording without revealing content.
    const receiptToken = randomToken(24);

    // 8. Atomic: insert encrypted ballot, flip has_voted, write the receipt.
    const { error: txErr } = await supabaseAdmin.rpc("cast_ballot_tx", {
      p_election_id: data.electionId,
      p_voter_id: voterId,
      p_ciphertext: encrypted.ciphertext,
      p_iv: encrypted.iv,
      p_encrypted_key: encrypted.encryptedKey,
      p_signature: signature,
      p_ballot_hash: ballotHash,
      p_receipt_hash: ballotHash,
      p_receipt_token: receiptToken,
    });
    if (txErr) {
      if (txErr.message?.includes("not_eligible_or_already_voted")) {
        return { success: false as const, error: "You have already voted in this election." };
      }
      return { success: false as const, error: "Failed to record ballot. Please try again." };
    }

    // 9. Audit — hash reference only, never ballot content.
    await appendAudit("voter:#anon", "BALLOT_SUBMITTED", data.electionId, `ballot_hash=${ballotHash.slice(0, 16)}…`);

    return { success: true as const, receiptToken, ballotHash, castAt: new Date().toISOString() };
  });

// Live turnout (total ballots cast) — a safe aggregate, never a per-candidate count.
export const getTurnout = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ electionId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { count } = await supabaseAdmin
      .from("ballot_receipts")
      .select("id", { count: "exact", head: true })
      .eq("election_id", data.electionId);
    return { ballotsCast: count ?? 0 };
  });

// Record authentication events in the audit log (login success/failure, TOTP).
export const logAuthEvent = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        type: z.enum(["login_success", "login_failure", "totp_verified", "account_locked"]),
        email: z.string().trim().email().max(255).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const actor = data.email ? `user:${data.email}` : "SYSTEM";
    const actionMap: Record<string, string> = {
      login_success: "LOGIN_SUCCESS",
      login_failure: "LOGIN_FAILURE",
      totp_verified: "TOTP_VERIFIED",
      account_locked: "ACCOUNT_LOCKED",
    };
    await appendAudit(actor, actionMap[data.type], null, "");
    return { ok: true as const };
  });
