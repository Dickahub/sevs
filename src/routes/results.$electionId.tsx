import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/sevs/AppShell";
import { getElectionResults, getMe } from "@/lib/sevs-read.functions";
import { exportResultsCsv, exportResultsPdf } from "@/lib/sevs-results.functions";
import { formatDateTime } from "@/lib/sevs-types";
import { requireAuth } from "@/lib/sevs-guard";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ShieldCheck, Trophy, Lock, Download, Radio } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/results/$electionId")({
  ssr: false,
  beforeLoad: () => requireAuth(),
  head: () => ({
    meta: [
      { title: "Results · SEVS" },
      { name: "description", content: "Verified, hash-chained election results." },
    ],
  }),
  component: ResultsPage,
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

function ResultsPage() {
  const { electionId } = Route.useParams();
  const fetchResults = useServerFn(getElectionResults);
  const fetchMe = useServerFn(getMe);
  const csvFn = useServerFn(exportResultsCsv);
  const pdfFn = useServerFn(exportResultsPdf);

  const { data, isLoading } = useQuery({
    queryKey: ["results", electionId],
    queryFn: () => fetchResults({ data: { electionId } }),
  });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => fetchMe() });

  // Live tally via SSE while results are published (updates every 5 seconds).
  const [live, setLive] = useState<{ counts: Record<string, number>; totalVotes: number; ballotsCast: number } | null>(null);
  const [streaming, setStreaming] = useState(false);
  const publishedOrClosed = data && !data.sealed;
  useEffect(() => {
    if (!publishedOrClosed) return;
    const es = new EventSource(`/api/public/results-stream/${electionId}`);
    es.onopen = () => setStreaming(true);
    es.onmessage = (ev) => {
      try {
        const p = JSON.parse(ev.data);
        if (p && !p.sealed) setLive({ counts: p.counts, totalVotes: p.totalVotes, ballotsCast: p.ballotsCast });
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => setStreaming(false);
    return () => es.close();
  }, [electionId, publishedOrClosed]);

  const [exporting, setExporting] = useState<"csv" | "pdf" | null>(null);
  async function handleExport(kind: "csv" | "pdf") {
    setExporting(kind);
    try {
      const res = kind === "csv" ? await csvFn({ data: { electionId } }) : await pdfFn({ data: { electionId } });
      if (res.ok) {
        downloadBase64(res.filename, res.mime, res.base64);
        toast.success(`Results exported as ${kind.toUpperCase()}`);
      } else {
        toast.error(res.error);
      }
    } finally {
      setExporting(null);
    }
  }

  const counts = live?.counts ?? data?.counts ?? {};
  const totalVotes = live?.totalVotes ?? data?.totalVotes ?? 0;
  const ballotsCast = live?.ballotsCast ?? data?.ballotsCast ?? 0;

  return (
    <AppShell>
      <Link
        to="/results"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> All results
      </Link>

      {isLoading && <p className="text-sm text-muted-foreground">Loading results…</p>}
      {!isLoading && !data?.election && (
        <p className="text-sm text-muted-foreground">This election could not be found.</p>
      )}

      {/* Results are sealed until the election closes or is published. */}
      {data?.election && data.sealed && (
        <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-[var(--shadow-card)]">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Lock className="h-7 w-7" />
          </div>
          <h1 className="mt-5 text-xl font-semibold">Results are sealed</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            No counts — not even partial — are available while {data.election.title} is open. Results
            unlock once voting closes and the ballots are tallied.
          </p>
        </div>
      )}

      {data?.election && !data.sealed && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{data.election.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {data.election.organisation} · Closed {formatDateTime(data.election.closesAt)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {data.resultsPublished && streaming && (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
                  <Radio className="h-3.5 w-3.5 animate-pulse" /> Live
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 rounded-md border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-medium text-success">
                <ShieldCheck className="h-3.5 w-3.5" /> Hash chain verified
              </span>
            </div>
          </div>

          {/* Participation summary */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Eligible voters", value: data.eligibleVoters.toLocaleString() },
              { label: "Ballots cast", value: ballotsCast.toLocaleString() },
              { label: "Participation", value: `${data.eligibleVoters > 0 ? Math.round((ballotsCast / data.eligibleVoters) * 100) : 0}%` },
              { label: "Votes counted", value: totalVotes.toLocaleString() },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="mt-1 text-xl font-semibold">{s.value}</p>
              </div>
            ))}
          </div>

          {me?.isAdmin && (
            <div className="mt-4 flex gap-2">
              <Button variant="outline" size="sm" onClick={() => handleExport("pdf")} disabled={exporting !== null}>
                <Download className="mr-1.5 h-4 w-4" /> {exporting === "pdf" ? "Exporting…" : "Export PDF"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleExport("csv")} disabled={exporting !== null}>
                <Download className="mr-1.5 h-4 w-4" /> {exporting === "csv" ? "Exporting…" : "Export CSV"}
              </Button>
            </div>
          )}

          <div className="mt-8 space-y-8">
            {data.positions.map((pos) => {
              const tallies = pos.candidates.map((c) => ({ cand: c, votes: counts[c.id] ?? 0 }));
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
                    <span className="text-xs text-muted-foreground">
                      {pos.seats} seat{pos.seats > 1 ? "s" : ""}
                    </span>
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
                              {isElected && t.votes > 0 && (
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
        </>
      )}
    </AppShell>
  );
}
