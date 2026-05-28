import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/sevs/AppShell";
import { StatusBadge } from "@/components/sevs/StatusBadge";
import { elections, formatDateTime, turnoutPct } from "@/lib/sevs-data";
import { Button } from "@/components/ui/button";
import { Plus, Download, Users, Vote, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Administration · SEVS" },
      { name: "description", content: "Manage elections, candidates, and voter rolls." },
    ],
  }),
  component: Admin,
});

function Admin() {
  const totalVoters = elections.reduce((a, e) => a + e.eligibleVoters, 0);
  const totalBallots = elections.reduce((a, e) => a + e.ballotsCast, 0);

  return (
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Administration</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure elections and oversee voter rolls. All actions are recorded in the audit log.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Download className="mr-1.5 h-4 w-4" /> Export reports
          </Button>
          <Button>
            <Plus className="mr-1.5 h-4 w-4" /> New election
          </Button>
        </div>
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <Stat label="Eligible voters" value={totalVoters.toLocaleString()} icon={Users} />
        <Stat label="Ballots cast" value={totalBallots.toLocaleString()} icon={Vote} />
        <Stat label="Audit chain" value="Verified" icon={ShieldCheck} good />
      </div>

      <div className="mt-10 overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)]">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-5 py-3 text-left font-medium">Election</th>
              <th className="px-5 py-3 text-left font-medium">Status</th>
              <th className="px-5 py-3 text-left font-medium">Window</th>
              <th className="px-5 py-3 text-left font-medium">Turnout</th>
              <th className="px-5 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {elections.map((e) => (
              <tr key={e.id} className="border-t border-border">
                <td className="px-5 py-4">
                  <div className="font-medium">{e.title}</div>
                  <div className="text-xs text-muted-foreground">{e.organisation}</div>
                </td>
                <td className="px-5 py-4">
                  <StatusBadge status={e.status} />
                </td>
                <td className="px-5 py-4 text-muted-foreground">
                  <div>{formatDateTime(e.opensAt)}</div>
                  <div className="text-xs">→ {formatDateTime(e.closesAt)}</div>
                </td>
                <td className="px-5 py-4">
                  <div className="font-mono text-xs">
                    {e.ballotsCast.toLocaleString()} / {e.eligibleVoters.toLocaleString()}
                  </div>
                  <div className="mt-1 h-1.5 w-32 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-success" style={{ width: `${turnoutPct(e)}%` }} />
                  </div>
                </td>
                <td className="px-5 py-4 text-right">
                  <button className="text-sm font-medium text-primary hover:underline">Manage</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  good,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  good?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <div
          className={
            good
              ? "flex h-8 w-8 items-center justify-center rounded-md bg-success/15 text-success"
              : "flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary"
          }
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}
