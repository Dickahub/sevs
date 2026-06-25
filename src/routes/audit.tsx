import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/sevs/AppShell";
import { getAuditLog, getMe } from "@/lib/sevs-read.functions";
import { verifyAuditChain, exportAuditPdf } from "@/lib/sevs-results.functions";
import { formatDateTime } from "@/lib/sevs-types";
import { requireAuth } from "@/lib/sevs-guard";
import { Button } from "@/components/ui/button";
import { ShieldCheck, ShieldAlert, Download } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/audit")({
  ssr: false,
  beforeLoad: () => requireAuth(),
  head: () => ({
    meta: [
      { title: "Audit log · SEVS" },
      { name: "description", content: "Tamper-evident, SHA-256 hash-chained record of every system event." },
    ],
  }),
  component: Audit,
});

function downloadBase64(filename: string, mime: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function Audit() {
  const fetchAudit = useServerFn(getAuditLog);
  const fetchMe = useServerFn(getMe);
  const verifyFn = useServerFn(verifyAuditChain);
  const exportFn = useServerFn(exportAuditPdf);
  const { data, isLoading } = useQuery({
    queryKey: ["audit"],
    queryFn: () => fetchAudit(),
  });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => fetchMe() });
  const entries = data?.entries ?? [];

  const [verified, setVerified] = useState<{ valid: boolean; brokenAtSeq: number | null } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function handleVerify() {
    setVerifying(true);
    try {
      const res = await verifyFn();
      setVerified(res);
      if (res.valid) toast.success(`Chain valid — ${res.total} entries verified`);
      else toast.error(`Chain BROKEN at entry #${res.brokenAtSeq}`);
    } finally {
      setVerifying(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const res = await exportFn({ data: {} });
      if (res.ok) {
        downloadBase64(res.filename, res.mime, res.base64);
        toast.success("Signed audit report exported");
      }
    } finally {
      setExporting(false);
    }
  }

  return (
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every event is hash-chained with SHA-256. Any tampering breaks the chain.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {me?.isAdmin && (
            <>
              <Button variant="outline" size="sm" onClick={handleVerify} disabled={verifying}>
                <ShieldCheck className="mr-1.5 h-4 w-4" /> {verifying ? "Verifying…" : "Verify chain"}
              </Button>
              <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
                <Download className="mr-1.5 h-4 w-4" /> {exporting ? "Exporting…" : "Signed PDF"}
              </Button>
            </>
          )}
          <div
            className={
              "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium " +
              (verified && !verified.valid
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : "border-success/30 bg-success/10 text-success")
            }
          >
            {verified && !verified.valid ? (
              <>
                <ShieldAlert className="h-3.5 w-3.5" /> Chain broken at #{verified.brokenAtSeq}
              </>
            ) : (
              <>
                <ShieldCheck className="h-3.5 w-3.5" />{" "}
                {verified ? "Chain verified" : "Hash-chained"} — {entries.length} entries
              </>
            )}
          </div>
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
              {isLoading && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {entries.map((row) => (
                <tr key={row.seq} className="border-t border-border align-top">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{row.seq}</td>
                  <td className="px-4 py-3 text-xs">{formatDateTime(row.ts)}</td>
                  <td className="px-4 py-3 font-mono text-xs">{row.actor}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-md bg-primary/8 px-2 py-0.5 font-mono text-xs text-primary">
                      {row.action}
                    </span>
                    {row.details && (
                      <div className="mt-1 text-xs text-muted-foreground">{row.details}</div>
                    )}
                    {row.electionId && (
                      <div className="mt-1 font-mono text-[11px] text-muted-foreground/70">{row.electionId}</div>
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
