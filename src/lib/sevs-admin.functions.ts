import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { randomBytes } from "crypto";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { appendAudit, sha256 } from "@/lib/sevs-audit.server";

// ============================================================================
// Helpers
// ============================================================================

async function requireAdmin(userId: string) {
  const { data } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  if (!(data ?? []).some((r) => r.role === "admin")) {
    throw new Error("Forbidden: administrator access required.");
  }
}

function actorTag(userId: string) {
  return `admin:#${userId.slice(0, 8)}`;
}

// --- WebCrypto helpers (Worker-safe) ----------------------------------------

function bufToB64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function toPem(label: string, buf: ArrayBuffer) {
  const b64 = bufToB64(buf).replace(/(.{64})/g, "$1\n");
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

// Generate an RSA-2048 key pair. Returns the public key as PEM and the private
// key encrypted with the given passphrase (PBKDF2 + AES-GCM), serialised as a
// self-describing JSON envelope so it can be decrypted later.
async function generateElectionKeys(passphrase: string) {
  const kp = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"],
  );

  const spki = await crypto.subtle.exportKey("spki", kp.publicKey);
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
  const publicKeyPem = toPem("PUBLIC KEY", spki);

  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const baseKey = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  const aesKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, pkcs8);

  const envelope = JSON.stringify({
    v: 1,
    alg: "RSA-2048",
    kdf: "PBKDF2-SHA256",
    iterations: 150000,
    salt: bufToB64(salt.buffer),
    iv: bufToB64(iv.buffer),
    ciphertext: bufToB64(ct),
  });

  return { publicKeyPem, encryptedPrivateKey: envelope };
}

// ============================================================================
// Voter accounts
// ============================================================================

const voterInput = z.object({
  studentNumber: z.string().trim().min(1).max(50),
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
});

type VoterInput = z.infer<typeof voterInput>;

interface CreateVoterResult {
  ok: boolean;
  error?: string;
  voterId?: string;
  fullName: string;
  email: string;
  studentNumber: string;
  token?: string;
  expiresAt?: string;
}

async function createOneVoter(input: VoterInput, actor: string): Promise<CreateVoterResult> {
  const email = input.email.toLowerCase();
  const base = { fullName: input.fullName, email, studentNumber: input.studentNumber };

  // Enforce uniqueness of email and student number across all accounts.
  const { data: byEmail } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  if (byEmail) return { ok: false, error: "Email already in use.", ...base };

  const { data: byStudent } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("student_id", input.studentNumber)
    .maybeSingle();
  if (byStudent) return { ok: false, error: "Student number already in use.", ...base };

  // Create the auth account (confirmed) with a random unusable temp password.
  const tempPassword = randomBytes(24).toString("base64url");
  const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: input.fullName, student_id: input.studentNumber },
  });
  if (error || !created.user) {
    return { ok: false, error: error?.message ?? "Failed to create account.", ...base };
  }

  // One-time setup token, valid 48 hours.
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  await supabaseAdmin.from("voter_setup_tokens").insert({
    voter_id: created.user.id,
    token_hash: sha256(token),
    expires_at: expiresAt,
  });

  await appendAudit(actor, "VOTER_CREATED", null);
  return { ok: true, voterId: created.user.id, token, expiresAt, ...base };
}

export const createVoter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => voterInput.parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    return createOneVoter(data, actorTag(context.userId));
  });

export const bulkCreateVoters = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ rows: z.array(voterInput).min(1).max(500) }).parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const actor = actorTag(context.userId);
    const results: CreateVoterResult[] = [];
    for (const row of data.rows) {
      results.push(await createOneVoter(row, actor));
    }
    return {
      results,
      created: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    };
  });

export const resendSetupLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ voterId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const { error } = await supabaseAdmin.from("voter_setup_tokens").insert({
      voter_id: data.voterId,
      token_hash: sha256(token),
      expires_at: expiresAt,
    });
    if (error) return { ok: false as const, error: "Could not create a new setup link." };
    await appendAudit(actorTag(context.userId), "SETUP_LINK_REISSUED", null);
    return { ok: true as const, token, expiresAt };
  });

export const setVoterActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ voterId: z.string().uuid(), isActive: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ is_active: data.isActive })
      .eq("id", data.voterId);
    if (error) return { ok: false as const, error: error.message };
    await appendAudit(
      actorTag(context.userId),
      data.isActive ? "VOTER_ACTIVATED" : "VOTER_DEACTIVATED",
      null,
    );
    return { ok: true as const };
  });

// Soft delete preserves audit integrity: the row stays, is_active becomes false.
export const deleteVoter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ voterId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ is_active: false })
      .eq("id", data.voterId);
    if (error) return { ok: false as const, error: error.message };
    await appendAudit(actorTag(context.userId), "VOTER_DELETED_SOFT", null);
    return { ok: true as const };
  });

export const listVoters = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, student_id, email, is_active, created_at")
      .order("created_at", { ascending: true });

    const nowIso = new Date().toISOString();
    const { data: tokens } = await supabaseAdmin
      .from("voter_setup_tokens")
      .select("voter_id")
      .is("used_at", null)
      .gt("expires_at", nowIso);
    const pending = new Set((tokens ?? []).map((t) => t.voter_id));

    return {
      voters: (profiles ?? []).map((p) => ({
        id: p.id,
        fullName: p.full_name,
        studentNumber: p.student_id,
        email: p.email,
        isActive: p.is_active,
        hasPendingSetup: pending.has(p.id),
        createdAt: p.created_at,
      })),
    };
  });

// ============================================================================
// Elections
// ============================================================================

const createElectionInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    organisation: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional().default(""),
    opensAt: z.string().datetime(),
    closesAt: z.string().datetime(),
    positions: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(120),
          seats: z.number().int().min(1).max(50),
        }),
      )
      .min(1)
      .max(40),
  })
  .refine((v) => new Date(v.closesAt).getTime() > new Date(v.opensAt).getTime(), {
    message: "End time must be after the start time.",
    path: ["closesAt"],
  });

export const createElection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createElectionInput.parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);

    // Per-election RSA-2048 key pair. Passphrase is generated, shown once, and
    // never stored — only the encrypted private key is persisted.
    const passphrase = randomBytes(24).toString("base64url");
    const { publicKeyPem, encryptedPrivateKey } = await generateElectionKeys(passphrase);

    const { data: election, error: elErr } = await supabaseAdmin
      .from("elections")
      .insert({
        title: data.title,
        organisation: data.organisation,
        description: data.description || null,
        status: "draft",
        opens_at: data.opensAt,
        closes_at: data.closesAt,
        eligible_voters: 0,
        public_key: publicKeyPem,
      })
      .select("id")
      .single();
    if (elErr || !election) {
      return { ok: false as const, error: elErr?.message ?? "Failed to create election." };
    }

    const positionRows = data.positions.map((p, i) => ({
      election_id: election.id,
      title: p.title,
      seats: p.seats,
      sort_order: i,
    }));
    const { error: posErr } = await supabaseAdmin.from("positions").insert(positionRows);
    if (posErr) {
      await supabaseAdmin.from("elections").delete().eq("id", election.id);
      return { ok: false as const, error: "Failed to create positions." };
    }

    await supabaseAdmin.from("election_keys").insert({
      election_id: election.id,
      encrypted_private_key: encryptedPrivateKey,
      key_algorithm: "RSA-2048",
    });

    await appendAudit(actorTag(context.userId), "ELECTION_CREATED", election.id);
    return { ok: true as const, electionId: election.id, passphrase };
  });

export const listAdminElections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    const { data: elections } = await supabaseAdmin
      .from("elections")
      .select("id, title, organisation, description, status, opens_at, closes_at, positions(id, title, seats)")
      .order("created_at", { ascending: false });

    const { data: elig } = await supabaseAdmin.from("election_eligibility").select("election_id");
    const eligCount: Record<string, number> = {};
    for (const r of elig ?? []) eligCount[r.election_id] = (eligCount[r.election_id] ?? 0) + 1;

    const { data: cands } = await supabaseAdmin
      .from("candidates")
      .select("id, position_id, positions(election_id)");
    const candCount: Record<string, number> = {};
    for (const c of cands ?? []) {
      const eid = (c.positions as { election_id: string } | null)?.election_id;
      if (eid) candCount[eid] = (candCount[eid] ?? 0) + 1;
    }

    const now = Date.now();
    return {
      elections: (elections ?? []).map((e) => {
        const opensMs = new Date(e.opens_at).getTime();
        const closesMs = new Date(e.closes_at).getTime();
        const status = now < opensMs ? "draft" : now <= closesMs ? "open" : "closed";
        return {
          id: e.id,
          title: e.title,
          organisation: e.organisation,
          description: e.description,
          status: status as "draft" | "open" | "closed",
          opensAt: e.opens_at,
          closesAt: e.closes_at,
          hasOpened: now >= opensMs,
          eligibleCount: eligCount[e.id] ?? 0,
          candidateCount: candCount[e.id] ?? 0,
          positions: ((e.positions as Array<{ id: string; title: string; seats: number }>) ?? []).map(
            (p) => ({ id: p.id, title: p.title, seats: p.seats }),
          ),
        };
      }),
    };
  });

// ============================================================================
// Eligibility
// ============================================================================

const electionIdSchema = z.object({ electionId: z.string().uuid() });

export const listEligibility = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => electionIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { data: election } = await supabaseAdmin
      .from("elections")
      .select("opens_at")
      .eq("id", data.electionId)
      .maybeSingle();
    const canEdit = election ? Date.now() < new Date(election.opens_at).getTime() : false;

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, student_id, email, is_active")
      .order("full_name", { ascending: true });

    const { data: elig } = await supabaseAdmin
      .from("election_eligibility")
      .select("voter_id")
      .eq("election_id", data.electionId);
    const eligible = new Set((elig ?? []).map((r) => r.voter_id));

    return {
      canEdit,
      voters: (profiles ?? []).map((p) => ({
        id: p.id,
        fullName: p.full_name,
        studentNumber: p.student_id,
        email: p.email,
        isActive: p.is_active,
        eligible: eligible.has(p.id),
      })),
    };
  });

async function refreshEligibleCount(electionId: string) {
  const { count } = await supabaseAdmin
    .from("election_eligibility")
    .select("id", { count: "exact", head: true })
    .eq("election_id", electionId);
  await supabaseAdmin.from("elections").update({ eligible_voters: count ?? 0 }).eq("id", electionId);
}

export const setEligibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        electionId: z.string().uuid(),
        voterId: z.string().uuid(),
        eligible: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { data: election } = await supabaseAdmin
      .from("elections")
      .select("opens_at")
      .eq("id", data.electionId)
      .maybeSingle();
    if (!election) return { ok: false as const, error: "Election not found." };
    if (Date.now() >= new Date(election.opens_at).getTime()) {
      return { ok: false as const, error: "The eligibility list is locked once an election opens." };
    }

    if (data.eligible) {
      const { error } = await supabaseAdmin
        .from("election_eligibility")
        .upsert(
          { election_id: data.electionId, voter_id: data.voterId },
          { onConflict: "election_id,voter_id", ignoreDuplicates: true },
        );
      if (error) return { ok: false as const, error: error.message };
    } else {
      const { error } = await supabaseAdmin
        .from("election_eligibility")
        .delete()
        .eq("election_id", data.electionId)
        .eq("voter_id", data.voterId);
      if (error) return { ok: false as const, error: error.message };
    }

    await refreshEligibleCount(data.electionId);
    await appendAudit(
      actorTag(context.userId),
      data.eligible ? "ELIGIBILITY_ADDED" : "ELIGIBILITY_REMOVED",
      data.electionId,
    );
    return { ok: true as const };
  });

// ============================================================================
// Candidates
// ============================================================================

export const listCandidatesAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => electionIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { data: positions } = await supabaseAdmin
      .from("positions")
      .select("id, title, seats, sort_order, candidates(id, voter_id, name, bio, sort_order)")
      .eq("election_id", data.electionId)
      .order("sort_order", { ascending: true });

    // Candidates must be existing registered voters — offer active voters.
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, student_id, email")
      .eq("is_active", true)
      .order("full_name", { ascending: true });

    return {
      positions: (positions ?? []).map((p) => ({
        id: p.id,
        title: p.title,
        seats: p.seats,
        candidates: [
          ...((p.candidates as Array<{
            id: string;
            voter_id: string | null;
            name: string;
            bio: string | null;
            sort_order: number;
          }>) ?? []),
        ]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((c) => ({ id: c.id, voterId: c.voter_id, name: c.name, bio: c.bio ?? "" })),
      })),
      voters: (profiles ?? []).map((p) => ({
        id: p.id,
        fullName: p.full_name,
        studentNumber: p.student_id,
        email: p.email,
      })),
    };
  });

export const addCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        positionId: z.string().uuid(),
        voterId: z.string().uuid(),
        bio: z.string().trim().max(500).optional().default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", data.voterId)
      .maybeSingle();
    if (!profile) return { ok: false as const, error: "Candidate must be a registered voter." };

    const { data: position } = await supabaseAdmin
      .from("positions")
      .select("election_id")
      .eq("id", data.positionId)
      .maybeSingle();
    if (!position) return { ok: false as const, error: "Position not found." };

    const { count } = await supabaseAdmin
      .from("candidates")
      .select("id", { count: "exact", head: true })
      .eq("position_id", data.positionId);

    const { error } = await supabaseAdmin.from("candidates").insert({
      position_id: data.positionId,
      voter_id: data.voterId,
      name: profile.full_name ?? "Candidate",
      bio: data.bio || null,
      sort_order: count ?? 0,
    });
    if (error) {
      if (error.code === "23505") {
        return { ok: false as const, error: "This voter is already a candidate for this position." };
      }
      return { ok: false as const, error: error.message };
    }

    await appendAudit(actorTag(context.userId), "CANDIDATE_ADDED", position.election_id);
    return { ok: true as const };
  });

export const removeCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ candidateId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.userId);
    const { error } = await supabaseAdmin.from("candidates").delete().eq("id", data.candidateId);
    if (error) return { ok: false as const, error: error.message };
    await appendAudit(actorTag(context.userId), "CANDIDATE_REMOVED", null);
    return { ok: true as const };
  });
