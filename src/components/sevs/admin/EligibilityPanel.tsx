import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Lock, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listAdminElections, listEligibility, setEligibility } from "@/lib/sevs-admin.functions";

export function EligibilityPanel() {
  const qc = useQueryClient();
  const fetchElections = useServerFn(listAdminElections);
  const fetchEligibility = useServerFn(listEligibility);
  const setFn = useServerFn(setEligibility);

  const [electionId, setElectionId] = useState<string>("");
  const [filter, setFilter] = useState("");

  const { data: elData } = useQuery({
    queryKey: ["admin-elections"],
    queryFn: () => fetchElections(),
    retry: false,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["admin-eligibility", electionId],
    queryFn: () => fetchEligibility({ data: { electionId } }),
    enabled: !!electionId,
    retry: false,
  });

  async function toggle(voterId: string, eligible: boolean) {
    const res = await setFn({ data: { electionId, voterId, eligible } });
    if (!res.ok) {
      toast.error(res.error ?? "Failed");
      return;
    }
    qc.invalidateQueries({ queryKey: ["admin-eligibility", electionId] });
    qc.invalidateQueries({ queryKey: ["admin-elections"] });
  }

  const elections = elData?.elections ?? [];
  const voters = (data?.voters ?? []).filter((v) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return (
      (v.fullName ?? "").toLowerCase().includes(q) ||
      (v.email ?? "").toLowerCase().includes(q) ||
      (v.studentNumber ?? "").toLowerCase().includes(q)
    );
  });
  const canEdit = data?.canEdit ?? false;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Add or remove voters from an election's eligibility list. The list locks automatically once
        the election opens.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={electionId} onValueChange={setElectionId}>
          <SelectTrigger className="w-72">
            <SelectValue placeholder="Choose an election" />
          </SelectTrigger>
          <SelectContent>
            {elections.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {electionId && (
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search voters…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-64 pl-8"
            />
          </div>
        )}
      </div>

      {electionId && !canEdit && !isLoading && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Lock className="h-4 w-4" /> This election has opened — the eligibility list is locked.
        </div>
      )}

      {!electionId ? (
        <p className="text-sm text-muted-foreground">Select an election to manage its eligibility list.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Voter</TableHead>
                <TableHead>Student #</TableHead>
                <TableHead className="text-right">Eligible</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && voters.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    No voters match.
                  </TableCell>
                </TableRow>
              )}
              {voters.map((v) => (
                <TableRow key={v.id} className={v.isActive ? "" : "opacity-60"}>
                  <TableCell>
                    <div className="font-medium">{v.fullName ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{v.email ?? "—"}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{v.studentNumber ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <Switch
                      checked={v.eligible}
                      disabled={!canEdit}
                      onCheckedChange={(c) => toggle(v.id, c)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
