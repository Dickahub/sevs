import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { AppShell } from "@/components/sevs/AppShell";
import { getElection } from "@/lib/sevs-data";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Download, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/vote/$electionId/cast")({
  loader: ({ params }) => {
    const election = getElection(params.electionId);
    if (!election) throw notFound();
    return { election };
  },
  head: () => ({
    meta: [
      { title: "Ballot cast · SEVS" },
      { name: "description", content: "Your encrypted ballot has been recorded." },
    ],
  }),
  component: CastConfirmation,
});

function CastConfirmation() {
  const { election } = Route.useLoaderData();
  const receipt = "SEVS-2026-R-" + Math.random().toString(36).slice(2, 10).toUpperCase();
  const hash = Array.from({ length: 4 }, () =>
    Math.random().toString(16).slice(2, 10),
  ).join("");

  return (
    <AppShell>
      <div className="mx-auto max-w-xl text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/15 text-success">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Your ballot has been recorded</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Thank you for voting in <span className="font-medium text-foreground">{election.title}</span>.
          Your ballot was encrypted, signed, and appended to the election log.
        </p>

        <div className="mt-8 rounded-xl border border-border bg-card p-5 text-left shadow-[var(--shadow-card)]">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Verifiable receipt
          </p>
          <p className="mt-2 font-mono text-sm text-foreground">{receipt}</p>
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Ballot hash (SHA-256)
            </p>
            <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{hash}</p>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Keep this receipt to confirm your ballot was counted. It does not reveal how you voted.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button variant="outline">
            <Download className="mr-1.5 h-4 w-4" /> Download receipt
          </Button>
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
