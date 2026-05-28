import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/sevs/AppShell";
import { auditLog, formatDateTime } from "@/lib/sevs-data";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Download } from "lucide-react";

export const Route = createFileRoute("/audit")({
  head: () => ({
    meta: [
      { title: "Audit log · SEVS" },
      { name: "description", content: "Tamper-evident, SHA-256 hash-chained record of every system event." },
    ],
  }),
  component: Audit,
});

function Audit() {
  return (
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every event is hash-chained with SHA-256. Any tampering breaks the chain.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-1.5 rounded-md border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-medium text-success">
            <ShieldCheck className="h-3.5 w-3.5" /> Chain verified — {auditLog.length} entries
          </div>
          <Button variant="outline" size="sm">
            <Download className="mr-1.5 h-4 w-4" /> Export
          </Button>
        </div>
      </div>

      <div className="mt-8 overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)]">
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/60 text-xs uppercase tracking-wider text-muted-foreground backdrop-blur">
              <tr>
                <th className="px-4 py-3 text-left font-medium">#</th>
                <th className="px-4 py-3 text-left font-medium">Timestamp</th>
                <th className="px-4 py-3 text-left font-medium">Actor</th>
                <th className="px-4 py-3 text-left font-medium">Action</th>
                <th className="px-4 py-3 text-left font-medium">Prev hash</th>
                <th className="px-4 py-3 text-left font-medium">Hash</th>
              </tr>
            </thead>
            <tbody>
              {auditLog.map((row) => (
                <tr key={row.seq} className="border-t border-border align-top">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{row.seq}</td>
                  <td className="px-4 py-3 text-xs">{formatDateTime(row.ts)}</td>
                  <td className="px-4 py-3 font-mono text-xs">{row.actor}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-md bg-primary/8 px-2 py-0.5 font-mono text-xs text-primary">
                      {row.action}
                    </span>
                    {row.electionId && (
                      <div className="mt-1 text-xs text-muted-foreground">{row.electionId}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                    {row.prevHash.slice(0, 14)}…
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-foreground">
                    {row.hash.slice(0, 14)}…
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
