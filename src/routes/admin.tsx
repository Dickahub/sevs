import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/sevs/AppShell";
import { getAdminOverview } from "@/lib/sevs-read.functions";
import { requireAuth } from "@/lib/sevs-guard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VotersPanel } from "@/components/sevs/admin/VotersPanel";
import { ElectionsPanel } from "@/components/sevs/admin/ElectionsPanel";
import { EligibilityPanel } from "@/components/sevs/admin/EligibilityPanel";
import { CandidatesPanel } from "@/components/sevs/admin/CandidatesPanel";
import { Users, Vote, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/admin")({
  ssr: false,
  beforeLoad: () => requireAuth(),
  head: () => ({
    meta: [
      { title: "Administration · SEVS" },
      { name: "description", content: "Manage voters, elections, eligibility, and candidates." },
    ],
  }),
  component: Admin,
});

function Admin() {
  const fetchOverview = useServerFn(getAdminOverview);
  const { data, error } = useQuery({
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

  return (
    <AppShell>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Administration</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Oversee voters, elections, eligibility, and candidates. All actions are recorded in the
          audit log.
        </p>
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <Stat label="Registered voters" value={(data?.registeredVoters ?? 0).toLocaleString()} icon={Users} />
        <Stat label="Ballots cast" value={(data?.totalBallots ?? 0).toLocaleString()} icon={Vote} />
        <Stat label="Audit entries" value={(data?.auditCount ?? 0).toLocaleString()} icon={ShieldCheck} good />
      </div>

      <Tabs defaultValue="voters" className="mt-10">
        <TabsList>
          <TabsTrigger value="voters">Voters</TabsTrigger>
          <TabsTrigger value="elections">Elections</TabsTrigger>
          <TabsTrigger value="eligibility">Eligibility</TabsTrigger>
          <TabsTrigger value="candidates">Candidates</TabsTrigger>
        </TabsList>
        <TabsContent value="voters" className="mt-6">
          <VotersPanel />
        </TabsContent>
        <TabsContent value="elections" className="mt-6">
          <ElectionsPanel />
        </TabsContent>
        <TabsContent value="eligibility" className="mt-6">
          <EligibilityPanel />
        </TabsContent>
        <TabsContent value="candidates" className="mt-6">
          <CandidatesPanel />
        </TabsContent>
      </Tabs>
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
