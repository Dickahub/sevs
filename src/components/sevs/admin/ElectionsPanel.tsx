import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  X,
  KeyRound,
  Copy,
  ShieldCheck,
  Pause,
  Play,
  Calculator,
  Eye,
  EyeOff,
  FileDown,
  FileText,
} from "lucide-react";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createElection, listAdminElections } from "@/lib/sevs-admin.functions";
import {
  closeAndTally,
  setElectionSuspended,
  setResultsPublished,
  exportResultsCsv,
  exportResultsPdf,
} from "@/lib/sevs-results.functions";
import { formatDateTime, type AdminElection } from "@/lib/sevs-types";

interface PositionDraft {
  title: string;
  seats: number;
}

function downloadBase64(filename: string, mime: string, base64: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ElectionsPanel() {
  const qc = useQueryClient();
  const fetchElections = useServerFn(listAdminElections);
  const createFn = useServerFn(createElection);
  const suspendFn = useServerFn(setElectionSuspended);
  const tallyFn = useServerFn(closeAndTally);
  const publishFn = useServerFn(setResultsPublished);
  const csvFn = useServerFn(exportResultsCsv);
  const pdfFn = useServerFn(exportResultsPdf);

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

  // Lifecycle action state
  const [actingId, setActingId] = useState<string | null>(null);
  const [tallyTarget, setTallyTarget] = useState<AdminElection | null>(null);
  const [tallyPass, setTallyPass] = useState("");
  const [tallyBusy, setTallyBusy] = useState(false);

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

  async function toggleSuspend(e: AdminElection) {
    setActingId(e.id);
    const res = await suspendFn({ data: { electionId: e.id, suspended: !e.suspended } });
    setActingId(null);
    if (!res.ok) {
      toast.error(res.error ?? "Action failed");
      return;
    }
    toast.success(e.suspended ? "Election resumed" : "Election suspended");
    qc.invalidateQueries({ queryKey: ["admin-elections"] });
  }

  async function togglePublish(e: AdminElection) {
    setActingId(e.id);
    const res = await publishFn({ data: { electionId: e.id, published: !e.resultsPublished } });
    setActingId(null);
    if (!res.ok) {
      toast.error(res.error ?? "Action failed");
      return;
    }
    toast.success(e.resultsPublished ? "Results unpublished" : "Results published");
    qc.invalidateQueries({ queryKey: ["admin-elections"] });
  }

  async function runTally(e: React.FormEvent) {
    e.preventDefault();
    if (!tallyTarget) return;
    setTallyBusy(true);
    const res = await tallyFn({ data: { electionId: tallyTarget.id, passphrase: tallyPass } });
    setTallyBusy(false);
    if (!res.ok) {
      toast.error(res.error ?? "Tally failed");
      return;
    }
    toast.success(`Tally complete — ${res.decrypted}/${res.totalBallots} ballots decrypted`);
    setTallyTarget(null);
    setTallyPass("");
    qc.invalidateQueries({ queryKey: ["admin-elections"] });
  }

  async function exportCsv(e: AdminElection) {
    setActingId(e.id);
    const res = await csvFn({ data: { electionId: e.id } });
    setActingId(null);
    if (!res.ok) return toast.error(res.error ?? "Export failed");
    downloadBase64(res.filename, res.mime, res.base64);
  }

  async function exportPdf(e: AdminElection) {
    setActingId(e.id);
    const res = await pdfFn({ data: { electionId: e.id } });
    setActingId(null);
    if (!res.ok) return toast.error(res.error ?? "Export failed");
    downloadBase64(res.filename, res.mime, res.base64);
  }

  const elections = (data?.elections ?? []) as AdminElection[];

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
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && elections.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
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
                  <div className="flex flex-col items-start gap-1">
                    <StatusBadge status={e.status} />
                    {e.suspended && (
                      <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-destructive">
                        Suspended
                      </span>
                    )}
                    {e.resultsPublished && (
                      <span className="rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-success">
                        Published
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  <div>{formatDateTime(e.opensAt)}</div>
                  <div>→ {formatDateTime(e.closesAt)}</div>
                </TableCell>
                <TableCell className="text-sm">{e.positions.length}</TableCell>
                <TableCell className="text-sm">{e.eligibleCount}</TableCell>
                <TableCell className="text-sm">{e.candidateCount}</TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" disabled={actingId === e.id}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem onClick={() => toggleSuspend(e)}>
                        {e.suspended ? (
                          <>
                            <Play className="mr-2 h-4 w-4" /> Resume election
                          </>
                        ) : (
                          <>
                            <Pause className="mr-2 h-4 w-4" /> Suspend election
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={e.status !== "closed"}
                        onClick={() => {
                          setTallyTarget(e);
                          setTallyPass("");
                        }}
                      >
                        <Calculator className="mr-2 h-4 w-4" /> Close &amp; tally
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => togglePublish(e)}>
                        {e.resultsPublished ? (
                          <>
                            <EyeOff className="mr-2 h-4 w-4" /> Unpublish results
                          </>
                        ) : (
                          <>
                            <Eye className="mr-2 h-4 w-4" /> Publish results
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => exportCsv(e)}>
                        <FileDown className="mr-2 h-4 w-4" /> Export results (CSV)
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => exportPdf(e)}>
                        <FileText className="mr-2 h-4 w-4" /> Export results (PDF)
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Close & tally dialog */}
      <Dialog open={!!tallyTarget} onOpenChange={(o) => !o && setTallyTarget(null)}>
        <DialogContent>
          <form onSubmit={runTally}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Calculator className="h-5 w-5 text-primary" /> Close &amp; tally
              </DialogTitle>
              <DialogDescription>
                Enter the one-time passphrase shown when “{tallyTarget?.title}” was created. It
                decrypts every ballot to compute the final tally and publishes the results.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5 py-2">
              <Label htmlFor="pass">Private-key passphrase</Label>
              <Input
                id="pass"
                type="password"
                autoComplete="off"
                value={tallyPass}
                onChange={(ev) => setTallyPass(ev.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={tallyBusy || !tallyPass}>
                {tallyBusy ? "Decrypting ballots…" : "Run tally"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Passphrase reveal dialog (after creation) */}
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
