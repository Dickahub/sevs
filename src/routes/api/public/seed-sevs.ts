import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// One-time, idempotent seed endpoint for the demo.
// Creates the admin + demo voters (with known credentials) and a set of
// sample elections. Safe to call repeatedly: it skips work already done.

const PASSWORD_VOTER = "Vote#2026";
const PASSWORD_ADMIN = "Admin#2026";

interface SeedUser {
  email: string;
  password: string;
  fullName: string;
  studentId: string;
  role: "admin" | "voter";
}

const USERS: SeedUser[] = [
  { email: "admin@sevs.vote", password: PASSWORD_ADMIN, fullName: "Returning Officer", studentId: "ADMIN-001", role: "admin" },
  { email: "ada@sevs.vote", password: PASSWORD_VOTER, fullName: "Ada Lovelace", studentId: "s1000001", role: "voter" },
  { email: "grace@sevs.vote", password: PASSWORD_VOTER, fullName: "Grace Hopper", studentId: "s1000002", role: "voter" },
  { email: "alan@sevs.vote", password: PASSWORD_VOTER, fullName: "Alan Turing", studentId: "s1000003", role: "voter" },
  { email: "katherine@sevs.vote", password: PASSWORD_VOTER, fullName: "Katherine Johnson", studentId: "s1000004", role: "voter" },
];

async function findUserByEmail(email: string) {
  // Paginate through users to find an existing one (no direct getByEmail).
  let page = 1;
  for (;;) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function ensureUser(u: SeedUser) {
  let userId: string;
  const existing = await findUserByEmail(u.email);
  if (existing) {
    userId = existing.id;
  } else {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
      user_metadata: { full_name: u.fullName, student_id: u.studentId },
    });
    if (error) throw error;
    userId = data.user.id;
  }

  // Ensure profile (trigger may already have created it).
  await supabaseAdmin
    .from("profiles")
    .upsert({ id: userId, full_name: u.fullName, student_id: u.studentId }, { onConflict: "id" });

  // Ensure role.
  await supabaseAdmin
    .from("user_roles")
    .upsert({ user_id: userId, role: u.role }, { onConflict: "user_id,role" });

  return userId;
}

async function seedElections() {
  const { count } = await supabaseAdmin
    .from("elections")
    .select("id", { count: "exact", head: true });
  if ((count ?? 0) > 0) return { skipped: true };

  const now = Date.now();
  const day = 86_400_000;

  // --- Open: Student Council ---
  const { data: council } = await supabaseAdmin
    .from("elections")
    .insert({
      title: "Student Council 2026",
      organisation: "Faculty of Engineering",
      status: "open",
      opens_at: new Date(now - 2 * day).toISOString(),
      closes_at: new Date(now + 3 * day).toISOString(),
      eligible_voters: 2840,
    })
    .select("id")
    .single();

  const { data: pres } = await supabaseAdmin
    .from("positions")
    .insert({ election_id: council!.id, title: "Council President", seats: 1, sort_order: 0 })
    .select("id")
    .single();
  const { data: sec } = await supabaseAdmin
    .from("positions")
    .insert({ election_id: council!.id, title: "General Secretary", seats: 1, sort_order: 1 })
    .select("id")
    .single();

  await supabaseAdmin.from("candidates").insert([
    { position_id: pres!.id, name: "Amelia Okafor", programme: "MSc Computer Science", statement: "Transparent governance and stronger student support.", sort_order: 0 },
    { position_id: pres!.id, name: "Idris Halvorsen", programme: "BEng Mechanical", statement: "More lab access, fairer exam scheduling, real budget oversight.", sort_order: 1 },
    { position_id: pres!.id, name: "Sofia Marchetti", programme: "MEng Civil", statement: "Accountability, sustainability, and a council that listens.", sort_order: 2 },
    { position_id: sec!.id, name: "Jun-ho Park", programme: "BSc Software Eng.", statement: "Open minutes, public agendas, async participation.", sort_order: 0 },
    { position_id: sec!.id, name: "Noor El-Sayed", programme: "MSc Data Science", statement: "Modernise the council's tooling and member onboarding.", sort_order: 1 },
  ]);

  // --- Open: Class Reps (multi-seat) ---
  const { data: reps } = await supabaseAdmin
    .from("elections")
    .insert({
      title: "Class Representatives — Spring",
      organisation: "Department of Computing",
      status: "open",
      opens_at: new Date(now - day).toISOString(),
      closes_at: new Date(now + 2 * day).toISOString(),
      eligible_voters: 412,
    })
    .select("id")
    .single();
  const { data: repPos } = await supabaseAdmin
    .from("positions")
    .insert({ election_id: reps!.id, title: "Year 2 Representative", seats: 2, sort_order: 0 })
    .select("id")
    .single();
  await supabaseAdmin.from("candidates").insert([
    { position_id: repPos!.id, name: "Lina Brandt", programme: "BSc CS Y2", statement: "Clearer feedback loop with lecturers.", sort_order: 0 },
    { position_id: repPos!.id, name: "Tomás Aguilar", programme: "BSc CS Y2", statement: "Better mentoring across cohorts.", sort_order: 1 },
    { position_id: repPos!.id, name: "Mei Tanaka", programme: "BSc CS Y2", statement: "Faster turnaround on TA hiring.", sort_order: 2 },
    { position_id: repPos!.id, name: "Rasmus Lind", programme: "BSc CS Y2", statement: "Open-source the curriculum issues tracker.", sort_order: 3 },
  ]);

  // --- Closed: Academic Senate (with sample votes for results) ---
  const { data: senate } = await supabaseAdmin
    .from("elections")
    .insert({
      title: "Academic Senate Delegates",
      organisation: "University-wide",
      status: "closed",
      opens_at: new Date(now - 40 * day).toISOString(),
      closes_at: new Date(now - 30 * day).toISOString(),
      eligible_voters: 9120,
    })
    .select("id")
    .single();
  const { data: senPos } = await supabaseAdmin
    .from("positions")
    .insert({ election_id: senate!.id, title: "Senate Delegate", seats: 3, sort_order: 0 })
    .select("id")
    .single();
  const { data: senCands } = await supabaseAdmin
    .from("candidates")
    .insert([
      { position_id: senPos!.id, name: "Hugo Berre", programme: "MSc Physics", statement: "Bridge research and teaching.", sort_order: 0 },
      { position_id: senPos!.id, name: "Aïcha Diallo", programme: "MA History", statement: "Defend humanities funding.", sort_order: 1 },
      { position_id: senPos!.id, name: "Petros Vlachos", programme: "PhD Mathematics", statement: "PhD students deserve a real voice.", sort_order: 2 },
      { position_id: senPos!.id, name: "Yara Haddad", programme: "MSc Biotech", statement: "Open data, open labs.", sort_order: 3 },
    ])
    .select("id");

  // Seed anonymous tally votes for the closed election.
  const tallies = [1842, 1601, 1457, 1408];
  const voteRows: { election_id: string; position_id: string; candidate_id: string }[] = [];
  senCands!.forEach((c, i) => {
    for (let n = 0; n < tallies[i]; n++) {
      voteRows.push({ election_id: senate!.id, position_id: senPos!.id, candidate_id: c.id });
    }
  });
  // Insert in chunks to stay within limits.
  for (let i = 0; i < voteRows.length; i += 1000) {
    await supabaseAdmin.from("votes").insert(voteRows.slice(i, i + 1000));
  }

  return { skipped: false };
}

export const Route = createFileRoute("/api/public/seed-sevs")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const ids: Record<string, string> = {};
          for (const u of USERS) {
            ids[u.email] = await ensureUser(u);
          }
          const elections = await seedElections();
          return Response.json({ success: true, users: USERS.map((u) => u.email), elections });
        } catch (err) {
          console.error("seed-sevs failed", err);
          return Response.json(
            { success: false, error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          );
        }
      },
    },
  },
});
