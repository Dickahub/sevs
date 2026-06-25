import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { effectiveStatus } from "@/lib/sevs-types";

// Server-Sent Events endpoint that streams the live tally for a published or
// closed election every 5 seconds (REQ: RESULTS_PUBLISHED live results via SSE).
// Results are never streamed while an election is OPEN or DRAFT.

async function buildPayload(electionId: string) {
  const { data: e } = await supabaseAdmin
    .from("elections")
    .select("opens_at, closes_at, eligible_voters, results_published, tally")
    .eq("id", electionId)
    .maybeSingle();
  if (!e) return null;

  const allowed = effectiveStatus(e.opens_at, e.closes_at) === "closed" || e.results_published === true;
  if (!allowed) return { sealed: true as const };

  const tally = e.tally as { counts?: Record<string, number> } | null;
  let counts: Record<string, number> = tally?.counts ?? {};
  if (Object.keys(counts).length === 0) {
    const { data: votes } = await supabaseAdmin
      .from("votes")
      .select("candidate_id")
      .eq("election_id", electionId);
    counts = {};
    for (const v of votes ?? []) counts[v.candidate_id] = (counts[v.candidate_id] ?? 0) + 1;
  }
  const { count } = await supabaseAdmin
    .from("ballot_receipts")
    .select("id", { count: "exact", head: true })
    .eq("election_id", electionId);
  const totalVotes = Object.values(counts).reduce((a, b) => a + b, 0);

  return {
    sealed: false as const,
    counts,
    totalVotes,
    ballotsCast: count ?? 0,
    eligibleVoters: e.eligible_voters,
    ts: new Date().toISOString(),
  };
}

export const Route = createFileRoute("/api/public/results-stream/$electionId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const electionId = params.electionId;
        const encoder = new TextEncoder();
        let closed = false;

        const stream = new ReadableStream({
          async start(controller) {
            const send = async () => {
              if (closed) return;
              try {
                const payload = await buildPayload(electionId);
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
              } catch {
                // ignore transient errors; the next tick will retry
              }
            };
            await send();
            const interval = setInterval(send, 5000);
            // Stop after 10 minutes to avoid orphaned long-lived streams.
            const stop = setTimeout(() => {
              closed = true;
              clearInterval(interval);
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            }, 10 * 60 * 1000);
            (controller as unknown as { _cleanup?: () => void })._cleanup = () => {
              clearInterval(interval);
              clearTimeout(stop);
            };
          },
          cancel() {
            closed = true;
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
