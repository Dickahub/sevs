import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  listAdminElections,
  listCandidatesAdmin,
  addCandidate,
  removeCandidate,
} from "@/lib/sevs-admin.functions";

export function CandidatesPanel() {
  const qc = useQueryClient();
  const fetchElections = useServerFn(listAdminElections);
  const fetchCandidates = useServerFn(listCandidatesAdmin);
  const addFn = useServerFn(addCandidate);
  const removeFn = useServerFn(removeCandidate);

  const [electionId, setElectionId] = useState<string>("");
  const [dialogPosition, setDialogPosition] = useState<string | null>(null);
  const [voterId, setVoterId] = useState("");
  const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: elData } = useQuery({
    queryKey: ["admin-elections"],
    queryFn: () => fetchElections(),
    retry: false,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["admin-candidates", electionId],
    queryFn: () => fetchCandidates({ data: { electionId } }),
    enabled: !!electionId,
    retry: false,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["admin-candidates", electionId] });
    qc.invalidateQueries({ queryKey: ["admin-elections"] });
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!voterId || !dialogPosition) {
      toast.error("Select a voter.");
      return;
    }
    setBusy(true);
    const res = await addFn({ data: { positionId: dialogPosition, voterId, bio } });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error ?? "Failed");
      return;
    }
    toast.success("Candidate registered");
    setDialogPosition(null);
    setVoterId("");
    setBio("");
    invalidate();
  }

  async function handleRemove(candidateId: string) {
    const res = await removeFn({ data: { candidateId } });
    if (!res.ok) toast.error(res.error ?? "Failed");
    else toast.success("Candidate removed");
    invalidate();
  }

  const elections = elData?.elections ?? [];
  const positions = data?.positions ?? [];
  const voterOptions = data?.voters ?? [];

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Register candidates for each position. A candidate must be an existing voter and can stand
        only once per position.
      </p>

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

      {!electionId ? (
        <p className="text-sm text-muted-foreground">Select an election to manage candidates.</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : positions.length === 0 ? (
        <p className="text-sm text-muted-foreground">This election has no positions.</p>
      ) : (
        <div className="space-y-4">
          {positions.map((p) => (
            <div key={p.id} className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">{p.title}</h3>
                  <p className="text-xs text-muted-foreground">
                    {p.seats} seat{p.seats === 1 ? "" : "s"} · {p.candidates.length} candidate
                    {p.candidates.length === 1 ? "" : "s"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDialogPosition(p.id);
                    setVoterId("");
                    setBio("");
                  }}
                >
                  <UserPlus className="mr-1.5 h-4 w-4" /> Add candidate
                </Button>
              </div>
              {p.candidates.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {p.candidates.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3"
                    >
                      <div className="min-w-0">
                        <div className="font-medium">{c.name}</div>
                        {c.bio && <p className="mt-0.5 text-xs text-muted-foreground">{c.bio}</p>}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => handleRemove(c.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!dialogPosition} onOpenChange={(o) => !o && setDialogPosition(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Register a candidate</DialogTitle>
            <DialogDescription>Choose a registered voter and add an optional biography.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleAdd}>
            <div className="space-y-1.5">
              <Label>Voter</Label>
              <Select value={voterId} onValueChange={setVoterId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a voter" />
                </SelectTrigger>
                <SelectContent>
                  {voterOptions.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.fullName ?? v.email} {v.studentNumber ? `· ${v.studentNumber}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bio">Biography (optional, max 500)</Label>
              <Textarea
                id="bio"
                rows={4}
                maxLength={500}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
              />
              <p className="text-right text-xs text-muted-foreground">{bio.length}/500</p>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Register candidate"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
