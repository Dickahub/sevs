import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, X, KeyRound, Copy, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/sevs/StatusBadge";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createElection, listAdminElections } from "@/lib/sevs-admin.functions";
import { formatDateTime } from "@/lib/sevs-types";

interface PositionDraft {
  title: string;
  seats: number;
}

export function ElectionsPanel() {
  const qc = useQueryClient();
  const fetchElections = useServerFn(listAdminElections);
  const createFn = useServerFn(createElection);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-elections"],
    queryFn: () => fetchElections(),
    retry: false,
  });

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [description, setDescription] = useState("");
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [positions, setPositions] = useState<PositionDraft[]>([{ title: "", seats: 1 }]);
  const [passphrase, setPassphrase] = useState<string | null>(null);

  function reset() {
    setTitle("");
    setOrganisation("");
    setDescription("");
    setOpensAt("");
    setClosesAt("");
    setPositions([{ title: "", seats: 1 }]);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const clean = positions.filter((p) => p.title.trim());
    if (clean.length === 0) {
      toast.error("Add at least one position.");
      return;
    }
    if (!opensAt || !closesAt) {
      toast.error("Set the start and end times.");
      return;
    }
    if (new Date(closesAt).getTime() <= new Date(opensAt).getTime()) {
      toast.error("End time must be after the start time.");
      return;
    }
    setBusy(true);
    const res = await createFn({
      data: {
        title,
        organisation,
        description,
        opensAt: new Date(opensAt).toISOString(),
        closesAt: new Date(closesAt).toISOString(),
        positions: clean.map((p) => ({ title: p.title.trim(), seats: Number(p.seats) || 1 })),
      },
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error ?? "Could not create election");
      return;
    }
    setOpen(false);
    reset();
    setPassphrase(res.passphrase!);
    qc.invalidateQueries({ queryKey: ["admin-elections"] });
  }

  const elections = data?.elections ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Create elections with positions. Each one gets an RSA-2048 key pair; new elections start as
          DRAFT and open / close automatically at the configured times.
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-1.5 h-4 w-4" /> New election
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Create an election</DialogTitle>
              <DialogDescription>
                Title, description, schedule, and one or more positions are required.
              </DialogDescription>
            </DialogHeader>
            <form className="space-y-4" onSubmit={handleCreate}>
              <div className="space-y-1.5">
                <Label htmlFor="t">Title</Label>
                <Input id="t" value={title} onChange={(e) => setTitle(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="o">Organisation</Label>
                <Input id="o" value={organisation} onChange={(e) => setOrganisation(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="d">Description</Label>
                <Textarea id="d" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="s">Start</Label>
                  <Input id="s" type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="e">End</Label>
                  <Input id="e" type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} required />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Positions</Label>
                {positions.map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      placeholder="Position title"
                      value={p.title}
                      onChange={(e) =>
                        setPositions((arr) => arr.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                      }
                    />
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      className="w-20"
                      title="Seats"
                      value={p.seats}
                      onChange={(e) =>
                        setPositions((arr) =>
                          arr.map((x, j) => (j === i ? { ...x, seats: Number(e.target.value) } : x)),
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={positions.length === 1}
                      onClick={() => setPositions((arr) => arr.filter((_, j) => j !== i))}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPositions((arr) => [...arr, { title: "", seats: 1 }])}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add position
                </Button>
              </div>

              <DialogFooter>
                <Button type="submit" disabled={busy}>
                  {busy ? "Generating keys…" : "Create election"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Election</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Window</TableHead>
              <TableHead>Positions</TableHead>
              <TableHead>Eligible</TableHead>
              <TableHead>Candidates</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && elections.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No elections yet.
                </TableCell>
              </TableRow>
            )}
            {elections.map((e) => (
              <TableRow key={e.id}>
                <TableCell>
                  <div className="font-medium">{e.title}</div>
                  <div className="text-xs text-muted-foreground">{e.organisation}</div>
                </TableCell>
                <TableCell>
                  <StatusBadge status={e.status} />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  <div>{formatDateTime(e.opensAt)}</div>
                  <div>→ {formatDateTime(e.closesAt)}</div>
                </TableCell>
                <TableCell className="text-sm">{e.positions.length}</TableCell>
                <TableCell className="text-sm">{e.eligibleCount}</TableCell>
                <TableCell className="text-sm">{e.candidateCount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!passphrase} onOpenChange={(o) => !o && setPassphrase(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" /> Save the private-key passphrase
            </DialogTitle>
            <DialogDescription>
              This passphrase decrypts the election's RSA private key. It is shown only once and is
              never stored. Save it somewhere secure now.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3">
            <ShieldCheck className="h-4 w-4 shrink-0 text-success" />
            <code className="min-w-0 flex-1 break-all font-mono text-sm">{passphrase}</code>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                navigator.clipboard.writeText(passphrase ?? "");
                toast.success("Passphrase copied");
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setPassphrase(null)}>I've saved it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
