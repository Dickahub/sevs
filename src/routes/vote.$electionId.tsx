import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/sevs/AppShell";
import { getElectionDetail } from "@/lib/sevs-read.functions";
import { castBallot } from "@/lib/sevs.functions";
import { formatDateTime } from "@/lib/sevs-types";
import { requireAuth } from "@/lib/sevs-guard";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Lock, ShieldCheck, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/vote/$electionId")({
  beforeLoad: () => requireAuth(),
  head: () => ({
    meta: [
      { title: "Ballot · SEVS" },
      { name: "description", content: "Cast your encrypted ballot. Your selections are never linked back to you." },
    ],
  }),
  component: BallotPage,
});

function BallotPage() {
  const { electionId } = Route.useParams();
  const navigate = useNavigate();
  const fetchDetail = useServerFn(getElectionDetail);
  const submitBallot = useServerFn(castBallot);

  const { data, isLoading } = useQuery({
    queryKey: ["election-detail", electionId],
    queryFn: () => fetchDetail({ data: { electionId } }),
  });

  const [sel, setSel] = useState<Record<string, Set<string>>>({});
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function toggle(positionId: string, candidateId: string, seats: number) {
    setSel((prev) => {
      const current = new Set(prev[positionId] ?? []);
      if (current.has(candidateId)) {
        current.delete(candidateId);
      } else {
        if (seats === 1) current.clear();
        else if (current.size >= seats) return prev;
        current.add(candidateId);
      }
      return { ...prev, [positionId]: current };
    });
  }

  async function handleSubmit() {
    if (!data?.election) return;
    setSubmitting(true);
    setError("");
    const selections = (data.positions ?? [])
      .map((p) => ({ positionId: p.id, candidateIds: Array.from(sel[p.id] ?? []) }))
      .filter((s) => s.candidateIds.length > 0);
    const res = await submitBallot({ data: { electionId, selections } });
    setSubmitting(false);
    if (!res.success) {
      setError(res.error);
      setConfirming(false);
      return;
    }
    navigate({ to: "/vote/$electionId/cast", params: { electionId } });
  }

  if (isLoading) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">Loading ballot…</p>
      </AppShell>
    );
  }

  if (!data?.election) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">This election could not be found.</p>
      </AppShell>
    );
  }

  const election = data.election;
  const positions = data.positions;

  if (data.hasVoted) {
    return (
      <AppShell>
        <Link
          to="/dashboard"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to elections
        </Link>
        <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-[var(--shadow-card)]">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-success">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <h1 className="mt-5 text-xl font-semibold">You have already voted</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your ballot for {election.title} was recorded. Each voter may cast one ballot only.
          </p>
          <Link to="/vote/$electionId/cast" params={{ electionId }}>
            <Button className="mt-5">View your receipt</Button>
          </Link>
        </div>
      </AppShell>
    );
  }

  const totalPositions = positions.length;
  const completed = positions.filter((p) => (sel[p.id]?.size ?? 0) > 0).length;

  return (
    <AppShell>
      <Link
        to="/dashboard"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to elections
      </Link>

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{election.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {election.organisation} · Closes {formatDateTime(election.closesAt)}
          </p>

          <div className="mt-6 flex items-center gap-2 rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success">
            <Lock className="h-4 w-4" />
            Your selections are recorded anonymously and never linked back to you.
          </div>

          <div className="mt-8 space-y-8">
            {positions.map((pos) => {
              const chosen = sel[pos.id] ?? new Set<string>();
              return (
                <section key={pos.id}>
                  <header className="mb-3 flex items-baseline justify-between">
                    <h2 className="text-lg font-semibold">{pos.title}</h2>
                    <span className="text-xs text-muted-foreground">
                      Select up to {pos.seats} · {chosen.size}/{pos.seats} chosen
                    </span>
                  </header>
                  <div className="space-y-2">
                    {pos.candidates.map((cand) => {
                      const active = chosen.has(cand.id);
                      const disabled = !active && chosen.size >= pos.seats;
                      return (
                        <button
                          key={cand.id}
                          type="button"
                          disabled={disabled}
                          onClick={() => toggle(pos.id, cand.id, pos.seats)}
                          className={cn(
                            "flex w-full items-start gap-4 rounded-xl border bg-card p-4 text-left transition-all",
                            active ? "border-success ring-2 ring-success/30" : "border-border hover:border-primary/40",
                            disabled && "cursor-not-allowed opacity-50",
                          )}
                        >
                          <div
                            className={cn(
                              "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                              active ? "bg-success text-success-foreground" : "bg-secondary text-secondary-foreground",
                            )}
                          >
                            {cand.initials}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-medium">{cand.name}</p>
                              <span className="text-xs text-muted-foreground">{cand.programme}</span>
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">{cand.statement}</p>
                          </div>
                          <div
                            className={cn(
                              "mt-1 h-5 w-5 shrink-0 rounded-md border",
                              active ? "border-success bg-success text-success-foreground" : "border-border bg-background",
                            )}
                          >
                            {active && (
                              <svg viewBox="0 0 20 20" fill="currentColor" className="h-full w-full p-0.5">
                                <path
                                  fillRule="evenodd"
                                  d="M16.7 5.3a1 1 0 010 1.4l-7.4 7.4a1 1 0 01-1.4 0L3.3 9.5a1 1 0 011.4-1.4L8.6 12l6.7-6.7a1 1 0 011.4 0z"
                                  clipRule="evenodd"
                                />
                              </svg>
                            )}
                          </div>
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setSel((p) => ({ ...p, [pos.id]: new Set() }))}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Abstain for this position
                    </button>
                  </div>
                </section>
              );
            })}
          </div>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
            <h3 className="text-sm font-semibold">Ballot summary</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {completed} of {totalPositions} positions answered
            </p>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${totalPositions ? (completed / totalPositions) * 100 : 0}%` }}
              />
            </div>

            <div className="mt-4 space-y-3 text-sm">
              {positions.map((pos) => {
                const chosen = Array.from(sel[pos.id] ?? []);
                return (
                  <div key={pos.id} className="text-xs">
                    <p className="font-medium text-foreground">{pos.title}</p>
                    {chosen.length === 0 ? (
                      <p className="text-muted-foreground">— No selection —</p>
                    ) : (
                      chosen.map((cid) => {
                        const c = pos.candidates.find((x) => x.id === cid)!;
                        return (
                          <p key={cid} className="text-muted-foreground">
                            ✓ {c.name}
                          </p>
                        );
                      })
                    )}
                  </div>
                );
              })}
            </div>

            <Button className="mt-5 w-full" onClick={() => setConfirming(true)} disabled={completed === 0}>
              Review &amp; submit
            </Button>
            {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
            <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Once submitted, your ballot cannot be modified.
            </p>
          </div>
        </aside>
      </div>

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm"
          onClick={() => !submitting && setConfirming(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-[var(--shadow-elevated)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-success/15 text-success">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">Confirm your ballot</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Your ballot will be recorded anonymously and a verifiable receipt generated. This
              action cannot be undone.
            </p>
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
            <div className="mt-5 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setConfirming(false)} disabled={submitting}>
                Review again
              </Button>
              <Button className="flex-1" onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Submitting…" : "Submit ballot"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
