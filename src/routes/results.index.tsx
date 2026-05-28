import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/sevs/AppShell";
import { StatusBadge } from "@/components/sevs/StatusBadge";
import { elections, formatDateTime, turnoutPct } from "@/lib/sevs-data";
import { ArrowRight, Lock } from "lucide-react";

export const Route = createFileRoute("/results/")({
  head: () => ({
    meta: [
      { title: "Results · SEVS" },
      { name: "description", content: "Verified results for closed elections." },
    ],
  }),
  component: ResultsIndex,
});

function ResultsIndex() {
  return (
    <AppShell>
      <h1 className="text-2xl font-semibold tracking-tight">Results</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Live results are published only after an election closes. Results are verifiable
        against the public audit log.
      </p>

      <div className="mt-8 grid gap-3">
        {elections.map((e) => {
          const isOpen = e.status === "open";
          return (
            <div
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]"
            >
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold">{e.title}</h3>
                  <StatusBadge status={e.status} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {e.organisation} · {turnoutPct(e)}% turnout ·{" "}
                  {isOpen ? `Closes ${formatDateTime(e.closesAt)}` : `Closed ${formatDateTime(e.closesAt)}`}
                </p>
              </div>
              {isOpen ? (
                <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Lock className="h-3.5 w-3.5" /> Sealed until closure
                </div>
              ) : (
                <Link
                  to="/results/$electionId"
                  params={{ electionId: e.id }}
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  View results <ArrowRight className="h-4 w-4" />
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
