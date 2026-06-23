// Shared client-safe types for the SEVS app. These mirror the DTOs returned
// by the read server functions in `sevs-read.functions.ts`.

export type ElectionStatus = "draft" | "open" | "closed";

export interface ElectionSummary {
  id: string;
  title: string;
  organisation: string;
  status: ElectionStatus;
  opensAt: string;
  closesAt: string;
  eligibleVoters: number;
  ballotsCast: number;
}

export interface CandidateView {
  id: string;
  name: string;
  programme: string;
  statement: string;
  initials: string;
}

export interface PositionView {
  id: string;
  title: string;
  seats: number;
  candidates: CandidateView[];
}

export interface ElectionDetail {
  election: ElectionSummary;
  positions: PositionView[];
  hasVoted: boolean;
  receipt: { ballot_hash: string; cast_at: string } | null;
}

export interface AuditEntryView {
  seq: number;
  ts: string;
  actor: string;
  action: string;
  electionId: string | null;
  prevHash: string;
  hash: string;
}

export function turnoutPct(eligible: number, ballots: number) {
  if (!eligible) return 0;
  return Math.round((ballots / eligible) * 100);
}

// Elections move through their lifecycle automatically based on the configured
// window: DRAFT before the start time, OPEN during the window, CLOSED after.
export function effectiveStatus(opensAt: string, closesAt: string): ElectionStatus {
  const now = Date.now();
  if (now < new Date(opensAt).getTime()) return "draft";
  if (now <= new Date(closesAt).getTime()) return "open";
  return "closed";
}

// ---- admin DTOs -------------------------------------------------------------

export interface VoterRow {
  id: string;
  fullName: string | null;
  studentNumber: string | null;
  email: string | null;
  isActive: boolean;
  hasPendingSetup: boolean;
  createdAt: string;
}

export interface AdminPosition {
  id: string;
  title: string;
  seats: number;
}

export interface AdminElection {
  id: string;
  title: string;
  organisation: string;
  description: string | null;
  status: ElectionStatus;
  opensAt: string;
  closesAt: string;
  hasOpened: boolean;
  eligibleCount: number;
  candidateCount: number;
  positions: AdminPosition[];
}

export interface EligibilityVoter {
  id: string;
  fullName: string | null;
  studentNumber: string | null;
  email: string | null;
  isActive: boolean;
  eligible: boolean;
}

export interface AdminCandidate {
  id: string;
  voterId: string | null;
  name: string;
  bio: string;
}

export interface AdminCandidatePosition {
  id: string;
  title: string;
  seats: number;
  candidates: AdminCandidate[];
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
