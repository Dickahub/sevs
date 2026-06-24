import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { randomBytes } from "crypto";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { appendAudit, sha256 } from "@/lib/sevs-audit.server";
import { hybridEncrypt, signData } from "@/lib/sevs-crypto.server";
import { effectiveStatus } from "@/lib/sevs-types";

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

// REQ-VOTE: cast an encrypted, anonymous ballot.
// Validates JWT (middleware), active account, OPEN election, eligibility, and
// the one-vote guard; encrypts the ballot with the election public key (hybrid
// AES-256 + RSA-OAEP), signs the ballot hash (RSA-SHA256), then stores the
// ballot and marks the voter as having voted inside a single transaction.
export const castBallot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => castSchema.parse(input))
  .handler(async ({ data, context }) => {
    const voterId = context.userId;

    // 0. Account must be active.
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("is_active")
      .eq("id", voterId)
      .maybeSingle();
    if (prof && prof.is_active === false) {
      return { success: false as const, error: "Your account is inactive. Contact an administrator." };
    }

    // 1. Election must exist and be OPEN.
    const { data: election, error: elErr } = await supabaseAdmin
      .from("elections")
      .select("id, opens_at, closes_at, public_key")
      .eq("id", data.electionId)
      .single();
    if (elErr || !election) return { success: false as const, error: "Election not found." };
    const status = effectiveStatus(election.opens_at, election.closes_at);
    if (status === "draft") {
      return { success: false as const, error: "This election has not opened yet." };
    }
    if (status === "closed") {
      return { success: false as const, error: "Voting is closed for this election." };
    }
    if (!election.public_key) {
      return { success: false as const, error: "This election is missing its encryption key." };
    }

    // 2. Voter must be eligible and must not have already voted.
    const { data: elig } = await supabaseAdmin
      .from("election_eligibility")
      .select("has_voted")
      .eq("election_id", data.electionId)
      .eq("voter_id", voterId)
      .maybeSingle();
    if (!elig) {
      return { success: false as const, error: "You are not eligible to vote in this election." };
    }
    if (elig.has_voted) {
      return { success: false as const, error: "You have already voted in this election." };
    }

    // 3. Validate positions, candidates and seat limits.
    const { data: positions } = await supabaseAdmin
      .from("positions")
      .select("id, seats, candidates(id)")
      .eq("election_id", data.electionId);
    const posMap = new Map((positions ?? []).map((p) => [p.id, p]));

    const cleanSelections: { positionId: string; candidateIds: string[] }[] = [];
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
      }
      if (sel.candidateIds.length > 0) {
        cleanSelections.push({ positionId: sel.positionId, candidateIds: sel.candidateIds });
      }
    }

    // 4. Build the plaintext ballot. A random nonce ensures identical choices
    //    produce different ciphertexts (and an unlinkable content hash).
    const nonce = randomBytes(16).toString("hex");
    const plaintext = JSON.stringify({
      electionId: data.electionId,
      selections: cleanSelections,
      castAt: new Date().toISOString(),
      nonce,
    });
    const ballotHash = sha256(plaintext);

    // 5. Hybrid-encrypt the ballot and sign the ballot hash (RSA-SHA256).
    let encrypted: Awaited<ReturnType<typeof hybridEncrypt>>;
    let signature: string;
    try {
      encrypted = await hybridEncrypt(plaintext, election.public_key);
      signature = await signData(ballotHash);
    } catch {
      return { success: false as const, error: "Failed to secure your ballot. Please try again." };
    }

    // 6. Opaque, unguessable receipt token. Stored receipt fingerprint is a hash
    //    of the token, NOT the ballot content hash, so the receipt cannot be
    //    correlated to the encrypted ballot record.
    const receiptToken = randomBytes(24).toString("base64url");
    const receiptHash = sha256(receiptToken);

    // 7. Atomic: store encrypted ballot + flip has_voted + store receipt.
    const { error: txErr } = await supabaseAdmin.rpc("cast_ballot_tx", {
      p_election_id: data.electionId,
      p_voter_id: voterId,
      p_ciphertext: encrypted.ciphertext,
      p_iv: encrypted.iv,
      p_encrypted_key: encrypted.encryptedKey,
      p_signature: signature,
      p_ballot_hash: ballotHash,
      p_receipt_hash: receiptHash,
      p_receipt_token: receiptToken,
    });
    if (txErr) {
      if (txErr.message.includes("not_eligible_or_already_voted")) {
        return { success: false as const, error: "You have already voted in this election." };
      }
      return { success: false as const, error: "Failed to record ballot. Please try again." };
    }

    // 8. Audit — hash reference only, never ballot content.
    await appendAudit("SYSTEM", "BALLOT_SUBMITTED", `ballot_hash=${ballotHash.slice(0, 16)}…`, data.electionId);

    return {
      success: true as const,
      receiptToken,
      receiptHash,
      castAt: new Date().toISOString(),
    };
  });

const electionIdSchema = z.object({ electionId: z.string().uuid() });

// Live turnout (ballots cast) — safe aggregate, no identities.
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

// Whether the current user has already voted, plus their receipt.
export const getMyBallotStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => electionIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: receipt } = await supabaseAdmin
      .from("ballot_receipts")
      .select("receipt_token, ballot_hash, cast_at")
      .eq("election_id", data.electionId)
      .eq("voter_id", context.userId)
      .maybeSingle();
    return { hasVoted: !!receipt, receipt: receipt ?? null };
  });

// REQ-VOTE: verify a receipt token confirms a vote was recorded — WITHOUT
// revealing any ballot content. Returns only a boolean and the cast time.
export const verifyReceipt = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ token: z.string().trim().min(8).max(200) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { data: rcpt } = await supabaseAdmin
      .from("ballot_receipts")
      .select("cast_at, election_id")
      .eq("receipt_token", data.token)
      .maybeSingle();
    if (!rcpt) return { recorded: false as const };
    const { data: election } = await supabaseAdmin
      .from("elections")
      .select("title")
      .eq("id", rcpt.election_id)
      .maybeSingle();
    return {
      recorded: true as const,
      castAt: rcpt.cast_at,
      electionTitle: election?.title ?? null,
    };
  });
