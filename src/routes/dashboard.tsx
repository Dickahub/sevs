import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/sevs/AppShell";
import { StatusBadge } from "@/components/sevs/StatusBadge";
import { elections, formatDateTime, turnoutPct } from "@/lib/sevs-data";
import { Button } from "@/components/ui/button";
import { ArrowRight, Clock, Users } from "lucide-react";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Elections · SEVS" },
      { name: "description", content: "Active and recent elections you are eligible to vote in." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const open = elections.filter((e) => e.status === "open");
  const closed = elections.filter((e) => e.status === "closed");

  return (
    <AppShell>
      <div className="mb-10 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your elections</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            You are eligible to vote in {open.length} active {open.length === 1 ? "election" : "elections"}.
          </p>
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          Voter ID <span className="font-mono text-foreground">#41922</span> · Verified
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Open</h2>
        {open.map((e) => (
          <article
            key={e.id}
            className="group rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)] transition-shadow hover:shadow-lg"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold">{e.title}</h3>
                  <StatusBadge status={e.status} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{e.organisation}</p>
                <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1.5 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-4 w-4" /> Closes {formatDateTime(e.closesAt)}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="h-4 w-4" /> {e.ballotsCast.toLocaleString()} /{" "}
                    {e.eligibleVoters.toLocaleString()} cast · {turnoutPct(e)}% turnout
                  </span>
                </div>
                <div className="mt-3 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-success transition-all"
                    style={{ width: `${turnoutPct(e)}%` }}
                  />
                </div>
              </div>
              <Link to="/vote/$electionId" params={{ electionId: e.id }}>
                <Button>
                  Cast ballot <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </article>
        ))}
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Closed</h2>
        {closed.map((e) => (
          <article
            key={e.id}
            className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold">{e.title}</h3>
                  <StatusBadge status={e.status} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {e.organisation} · Closed {formatDateTime(e.closesAt)} · {turnoutPct(e)}% turnout
                </p>
              </div>
              <Link to="/results/$electionId" params={{ electionId: e.id }}>
                <Button variant="outline">View results</Button>
              </Link>
            </div>
          </article>
        ))}
      </section>
    </AppShell>
  );
}
