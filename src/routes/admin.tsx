import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/sevs/AppShell";
import { StatusBadge } from "@/components/sevs/StatusBadge";
import { getAdminOverview } from "@/lib/sevs-read.functions";
import { formatDateTime, turnoutPct } from "@/lib/sevs-types";
import { requireAuth } from "@/lib/sevs-guard";
import { Users, Vote, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/admin")({
  beforeLoad: () => requireAuth(),
  head: () => ({
    meta: [
      { title: "Administration · SEVS" },
      { name: "description", content: "Manage elections, candidates, and voter rolls." },
    ],
  }),
  component: Admin,
});

function Admin() {
  const fetchOverview = useServerFn(getAdminOverview);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => fetchOverview(),
    retry: false,
  });

  if (error) {
    return (
      <AppShell>
        <h1 className="text-2xl font-semibold tracking-tight">Administration</h1>
        <p className="mt-3 text-sm text-destructive">
          You need administrator access to view this page.
        </p>
      </AppShell>
    );
  }

  const elections = data?.elections ?? [];

  return (
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Administration</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Oversee elections and voter rolls. All actions are recorded in the audit log.
          </p>
        </div>
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <Stat label="Registered voters" value={(data?.registeredVoters ?? 0).toLocaleString()} icon={Users} />
        <Stat label="Ballots cast" value={(data?.totalBallots ?? 0).toLocaleString()} icon={Vote} />
        <Stat label="Audit entries" value={(data?.auditCount ?? 0).toLocaleString()} icon={ShieldCheck} good />
      </div>

      <div className="mt-10 overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)]">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-5 py-3 text-left font-medium">Election</th>
              <th className="px-5 py-3 text-left font-medium">Status</th>
              <th className="px-5 py-3 text-left font-medium">Window</th>
              <th className="px-5 py-3 text-left font-medium">Turnout</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4} className="px-5 py-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
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
                    <div
                      className="h-full bg-success"
                      style={{ width: `${turnoutPct(e.eligibleVoters, e.ballotsCast)}%` }}
                    />
                  </div>
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
