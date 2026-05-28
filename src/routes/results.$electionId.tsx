import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { AppShell } from "@/components/sevs/AppShell";
import { closedResults, getElection, formatDateTime, turnoutPct } from "@/lib/sevs-data";
import { ArrowLeft, ShieldCheck, Trophy } from "lucide-react";

export const Route = createFileRoute("/results/$electionId")({
  loader: ({ params }) => {
    const election = getElection(params.electionId);
    if (!election) throw notFound();
    return { election };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.election.title ?? "Results"} · SEVS` },
      { name: "description", content: "Verified, hash-chained election results." },
    ],
  }),
  component: ResultsPage,
});

function ResultsPage() {
  const { election } = Route.useLoaderData();
  const results = closedResults[election.id] ?? {};

  return (
    <AppShell>
      <Link
        to="/results"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> All results
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{election.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {election.organisation} · Closed {formatDateTime(election.closesAt)} · {turnoutPct(election)}% turnout
          </p>
        </div>
        <div className="inline-flex items-center gap-1.5 rounded-md border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-medium text-success">
          <ShieldCheck className="h-3.5 w-3.5" /> Hash chain verified
        </div>
      </div>

      <div className="mt-8 space-y-8">
        {election.positions.map((pos) => {
          const tallies = pos.candidates.map((c) => ({
            cand: c,
            votes: results[c.id] ?? 0,
          }));
          const total = tallies.reduce((a, b) => a + b.votes, 0) || 1;
          const sorted = [...tallies].sort((a, b) => b.votes - a.votes);
          const elected = new Set(sorted.slice(0, pos.seats).map((t) => t.cand.id));

          return (
            <section
              key={pos.id}
              className="rounded-xl border border-border bg-card p-6 shadow-[var(--shadow-card)]"
            >
              <div className="mb-5 flex items-baseline justify-between">
                <h2 className="text-lg font-semibold">{pos.title}</h2>
                <span className="text-xs text-muted-foreground">{pos.seats} seat{pos.seats > 1 ? "s" : ""}</span>
              </div>
              <ol className="space-y-3">
                {sorted.map((t, idx) => {
                  const pct = (t.votes / total) * 100;
                  const isElected = elected.has(t.cand.id);
                  return (
                    <li key={t.cand.id}>
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="w-4 font-mono text-xs text-muted-foreground">{idx + 1}</span>
                          <span className="font-medium">{t.cand.name}</span>
                          {isElected && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
                              <Trophy className="h-3 w-3" /> Elected
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-xs text-muted-foreground">
                          {t.votes.toLocaleString()} · {pct.toFixed(1)}%
                        </span>
                      </div>
                      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={isElected ? "h-full bg-success" : "h-full bg-primary/60"}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>
    </AppShell>
  );
}
