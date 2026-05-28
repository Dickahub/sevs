import { createFileRoute, Link, useNavigate, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/sevs/AppShell";
import { getElection, formatDateTime, type Election } from "@/lib/sevs-data";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/vote/$electionId")({
  loader: ({ params }) => {
    const election = getElection(params.electionId);
    if (!election) throw notFound();
    return { election };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.election.title ?? "Ballot"} · SEVS` },
      { name: "description", content: "Cast your encrypted ballot. Your selections are never linked back to you." },
    ],
  }),
  component: BallotPage,
});

function BallotPage() {
  const { election } = Route.useLoaderData();
  const navigate = useNavigate();
  // selections[positionId] = Set of candidate ids
  const [sel, setSel] = useState<Record<string, Set<string>>>({});
  const [confirming, setConfirming] = useState(false);

  function toggle(positionId: string, candidateId: string, seats: number) {
    setSel((prev) => {
      const current = new Set(prev[positionId] ?? []);
      if (current.has(candidateId)) {
        current.delete(candidateId);
      } else {
        if (seats === 1) {
          current.clear();
        } else if (current.size >= seats) {
          return prev;
        }
        current.add(candidateId);
      }
      return { ...prev, [positionId]: current };
    });
  }

  const totalPositions = election.positions.length;
  const completed = election.positions.filter((p) => (sel[p.id]?.size ?? 0) > 0).length;

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
            Your selections will be encrypted in your browser before submission.
          </div>

          <div className="mt-8 space-y-8">
            {election.positions.map((pos) => {
              const chosen = sel[pos.id] ?? new Set();
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
                            active
                              ? "border-success ring-2 ring-success/30"
                              : "border-border hover:border-primary/40",
                            disabled && "cursor-not-allowed opacity-50",
                          )}
                        >
                          <div
                            className={cn(
                              "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                              active
                                ? "bg-success text-success-foreground"
                                : "bg-secondary text-secondary-foreground",
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
                              active
                                ? "border-success bg-success text-success-foreground"
                                : "border-border bg-background",
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
                style={{ width: `${(completed / totalPositions) * 100}%` }}
              />
            </div>

            <div className="mt-4 space-y-3 text-sm">
              {election.positions.map((pos) => {
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

            <Button
              className="mt-5 w-full"
              onClick={() => setConfirming(true)}
              disabled={completed === 0}
            >
              Review & submit
            </Button>
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
          onClick={() => setConfirming(false)}
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
              Your ballot will be encrypted with the election public key and signed before
              submission. This action cannot be undone.
            </p>
            <div className="mt-4 rounded-md bg-muted/60 p-3 text-xs font-mono text-muted-foreground">
              ballot.sha256 = <span className="text-foreground">f3a9…1d8e</span>
            </div>
            <div className="mt-5 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setConfirming(false)}>
                Review again
              </Button>
              <Button
                className="flex-1"
                onClick={() =>
                  navigate({ to: "/vote/$electionId/cast", params: { electionId: election.id } })
                }
              >
                Encrypt & submit
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
