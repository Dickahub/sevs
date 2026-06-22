import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/sevs/AppShell";
import { getElectionDetail } from "@/lib/sevs-read.functions";
import { formatDateTime } from "@/lib/sevs-types";
import { requireAuth } from "@/lib/sevs-guard";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/vote/$electionId/cast")({
  ssr: false,
  beforeLoad: () => requireAuth(),
  head: () => ({
    meta: [
      { title: "Ballot cast · SEVS" },
      { name: "description", content: "Your ballot has been recorded." },
    ],
  }),
  component: CastConfirmation,
});

function CastConfirmation() {
  const { electionId } = Route.useParams();
  const fetchDetail = useServerFn(getElectionDetail);
  const { data, isLoading } = useQuery({
    queryKey: ["election-detail", electionId],
    queryFn: () => fetchDetail({ data: { electionId } }),
  });

  const receiptHash = data?.receipt?.ballot_hash ?? "";
  const castAt = data?.receipt?.cast_at;
  const receiptId = receiptHash ? "SEVS-2026-R-" + receiptHash.slice(0, 8).toUpperCase() : "";

  return (
    <AppShell>
      <div className="mx-auto max-w-xl text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/15 text-success">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Your ballot has been recorded</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isLoading
            ? "Loading your receipt…"
            : data?.election
              ? `Thank you for voting in ${data.election.title}. Your ballot was recorded and appended to the election log.`
              : "Your ballot was recorded."}
        </p>

        {receiptHash && (
          <div className="mt-8 rounded-xl border border-border bg-card p-5 text-left shadow-[var(--shadow-card)]">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Verifiable receipt
            </p>
            <p className="mt-2 font-mono text-sm text-foreground">{receiptId}</p>
            {castAt && (
              <p className="mt-1 text-xs text-muted-foreground">Cast {formatDateTime(castAt)}</p>
            )}
            <div className="mt-3 border-t border-border pt-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Ballot hash (SHA-256)
              </p>
              <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{receiptHash}</p>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Keep this receipt to confirm your ballot was counted. It does not reveal how you voted.
            </p>
          </div>
        )}

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link to="/dashboard">
            <Button>
              Back to elections <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
