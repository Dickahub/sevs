// Mock data for the Secure Electronic Voting System prototype.
// Replace with real Lovable Cloud / backend calls in a follow-up iteration.

export type ElectionStatus = "draft" | "open" | "closed";

export interface Candidate {
  id: string;
  name: string;
  programme: string;
  statement: string;
  initials: string;
}

export interface Position {
  id: string;
  title: string;
  seats: number;
  candidates: Candidate[];
}

export interface Election {
  id: string;
  title: string;
  organisation: string;
  status: ElectionStatus;
  opensAt: string;
  closesAt: string;
  eligibleVoters: number;
  ballotsCast: number;
  positions: Position[];
}

export interface AuditEntry {
  seq: number;
  ts: string;
  actor: string;
  action: string;
  electionId?: string;
  prevHash: string;
  hash: string;
}

const c = (id: string, name: string, programme: string, statement: string): Candidate => ({
  id,
  name,
  programme,
  statement,
  initials: name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join(""),
});

export const elections: Election[] = [
  {
    id: "elec-2026-council",
    title: "Student Council 2026",
    organisation: "Faculty of Engineering",
    status: "open",
    opensAt: "2026-05-25T09:00:00Z",
    closesAt: "2026-05-30T18:00:00Z",
    eligibleVoters: 2840,
    ballotsCast: 1612,
    positions: [
      {
        id: "pos-president",
        title: "Council President",
        seats: 1,
        candidates: [
          c("cand-1", "Amelia Okafor", "MSc Computer Science", "Transparent governance and stronger student support."),
          c("cand-2", "Idris Halvorsen", "BEng Mechanical", "More lab access, fairer exam scheduling, real budget oversight."),
          c("cand-3", "Sofia Marchetti", "MEng Civil", "Accountability, sustainability, and a council that actually listens."),
        ],
      },
      {
        id: "pos-secretary",
        title: "General Secretary",
        seats: 1,
        candidates: [
          c("cand-4", "Jun-ho Park", "BSc Software Eng.", "Open minutes, public agendas, async participation."),
          c("cand-5", "Noor El-Sayed", "MSc Data Science", "Modernise the council's tooling and member onboarding."),
        ],
      },
    ],
  },
  {
    id: "elec-2026-class-reps",
    title: "Class Representatives — Spring",
    organisation: "Department of Computing",
    status: "open",
    opensAt: "2026-05-26T09:00:00Z",
    closesAt: "2026-05-29T18:00:00Z",
    eligibleVoters: 412,
    ballotsCast: 188,
    positions: [
      {
        id: "pos-rep-y2",
        title: "Year 2 Representative",
        seats: 2,
        candidates: [
          c("cand-6", "Lina Brandt", "BSc CS Y2", "Clearer feedback loop with lecturers."),
          c("cand-7", "Tomás Aguilar", "BSc CS Y2", "Better mentoring across cohorts."),
          c("cand-8", "Mei Tanaka", "BSc CS Y2", "Faster turnaround on TA hiring."),
          c("cand-9", "Rasmus Lind", "BSc CS Y2", "Open-source the curriculum issues tracker."),
        ],
      },
    ],
  },
  {
    id: "elec-2026-senate",
    title: "Academic Senate Delegates",
    organisation: "University-wide",
    status: "closed",
    opensAt: "2026-04-10T09:00:00Z",
    closesAt: "2026-04-17T18:00:00Z",
    eligibleVoters: 9120,
    ballotsCast: 6308,
    positions: [
      {
        id: "pos-senate",
        title: "Senate Delegate",
        seats: 3,
        candidates: [
          c("cand-10", "Hugo Berre", "MSc Physics", "Bridge research and teaching."),
          c("cand-11", "Aïcha Diallo", "MA History", "Defend humanities funding."),
          c("cand-12", "Petros Vlachos", "PhD Mathematics", "PhD students deserve a real voice."),
          c("cand-13", "Yara Haddad", "MSc Biotech", "Open data, open labs."),
        ],
      },
    ],
  },
];

export const closedResults: Record<string, Record<string, number>> = {
  "elec-2026-senate": {
    "cand-10": 1842,
    "cand-11": 1601,
    "cand-12": 1457,
    "cand-13": 1408,
  },
};

export const auditLog: AuditEntry[] = [
  {
    seq: 1,
    ts: "2026-05-25T08:59:31Z",
    actor: "admin:laval",
    action: "ELECTION_OPENED",
    electionId: "elec-2026-council",
    prevHash: "0000000000000000000000000000000000000000000000000000000000000000",
    hash: "a91f0b2c84e1d3f5a6b8c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2",
  },
  {
    seq: 2,
    ts: "2026-05-25T09:04:12Z",
    actor: "voter:#anon",
    action: "BALLOT_CAST",
    electionId: "elec-2026-council",
    prevHash: "a91f0b2c84e1d3f5a6b8c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2",
    hash: "b13e91cc77a04d28e3c4a1b6f9e2d7c5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9",
  },
  {
    seq: 3,
    ts: "2026-05-25T09:11:47Z",
    actor: "voter:#anon",
    action: "BALLOT_CAST",
    electionId: "elec-2026-council",
    prevHash: "b13e91cc77a04d28e3c4a1b6f9e2d7c5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9",
    hash: "c204aa7d5e02b9f1842c6d3e1a5b7c9d0e2f4a6b8c1d3e5f7a9b1c3d5e7f9a1b",
  },
  {
    seq: 4,
    ts: "2026-05-25T09:42:08Z",
    actor: "admin:laval",
    action: "CANDIDATE_ADDED",
    electionId: "elec-2026-class-reps",
    prevHash: "c204aa7d5e02b9f1842c6d3e1a5b7c9d0e2f4a6b8c1d3e5f7a9b1c3d5e7f9a1b",
    hash: "d3f8b1e6a902c7d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8",
  },
  {
    seq: 5,
    ts: "2026-05-26T14:21:55Z",
    actor: "system",
    action: "AUDIT_VERIFIED",
    prevHash: "d3f8b1e6a902c7d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8",
    hash: "e4a7c9b2d1f3e5a8b6c4d2e0f8a7b5c3d1e9f7a5b3c1d9e7f5a3b1c9d7e5f3a1",
  },
];

export function getElection(id: string) {
  return elections.find((e) => e.id === id);
}

export function turnoutPct(e: Election) {
  return Math.round((e.ballotsCast / e.eligibleVoters) * 100);
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
