import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserPlus, Upload, Copy, Link2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
import {
  createVoter,
  bulkCreateVoters,
  setVoterActive,
  deleteVoter,
  resendSetupLink,
  listVoters,
} from "@/lib/sevs-admin.functions";

interface SetupLink {
  label: string;
  url: string;
}

function buildUrl(token: string) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/setup/${token}`;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Setup link copied to clipboard");
  } catch {
    toast.error("Could not copy — select and copy manually");
  }
}

export function VotersPanel() {
  const qc = useQueryClient();
  const fetchVoters = useServerFn(listVoters);
  const createFn = useServerFn(createVoter);
  const bulkFn = useServerFn(bulkCreateVoters);
  const activeFn = useServerFn(setVoterActive);
  const deleteFn = useServerFn(deleteVoter);
  const resendFn = useServerFn(resendSetupLink);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-voters"],
    queryFn: () => fetchVoters(),
    retry: false,
  });

  const [links, setLinks] = useState<SetupLink[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-voters"] });

  // single create
  const [sn, setSn] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await createFn({ data: { studentNumber: sn, fullName: name, email } });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error ?? "Could not create voter");
      return;
    }
    setLinks((l) => [{ label: `${res.fullName} (${res.email})`, url: buildUrl(res.token!) }, ...l]);
    toast.success("Voter created — copy their setup link below");
    setSn("");
    setName("");
    setEmail("");
    setAddOpen(false);
    refresh();
  }

  // bulk create
  const [csv, setCsv] = useState("");
  async function handleBulk(e: React.FormEvent) {
    e.preventDefault();
    const rows = csv
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !/^student_number\s*,/i.test(l))
      .map((l) => {
        const [studentNumber, fullName, mail] = l.split(",").map((c) => (c ?? "").trim());
        return { studentNumber, fullName, email: mail };
      })
      .filter((r) => r.studentNumber && r.fullName && r.email);

    if (rows.length === 0) {
      toast.error("No valid rows found. Use: student_number, full_name, email");
      return;
    }
    setBusy(true);
    const res = await bulkFn({ data: { rows } });
    setBusy(false);
    const newLinks = res.results
      .filter((r) => r.ok && r.token)
      .map((r) => ({ label: `${r.fullName} (${r.email})`, url: buildUrl(r.token!) }));
    setLinks((l) => [...newLinks, ...l]);
    res.results
      .filter((r) => !r.ok)
      .forEach((r) => toast.error(`${r.email}: ${r.error}`));
    toast.success(`Imported ${res.created} voter(s)${res.failed ? `, ${res.failed} failed` : ""}`);
    setCsv("");
    setBulkOpen(false);
    refresh();
  }

  async function toggleActive(id: string, isActive: boolean) {
    const res = await activeFn({ data: { voterId: id, isActive } });
    if (!res.ok) toast.error(res.error ?? "Failed");
    else toast.success(isActive ? "Account activated" : "Account deactivated");
    refresh();
  }

  async function softDelete(id: string) {
    const res = await deleteFn({ data: { voterId: id } });
    if (!res.ok) toast.error(res.error ?? "Failed");
    else toast.success("Account deleted (soft) — record kept for audit");
    refresh();
  }

  async function reissue(id: string, label: string) {
    const res = await resendFn({ data: { voterId: id } });
    if (!res.ok) {
      toast.error(res.error ?? "Failed");
      return;
    }
    setLinks((l) => [{ label, url: buildUrl(res.token!) }, ...l]);
    toast.success("New 48h setup link generated");
  }

  const voters = data?.voters ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Create voter accounts, manage their status, and share one-time setup links (valid 48 hours).
        </p>
        <div className="flex gap-2">
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <UserPlus className="mr-1.5 h-4 w-4" /> Add voter
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add a voter</DialogTitle>
                <DialogDescription>
                  Student number and email must be unique across all accounts.
                </DialogDescription>
              </DialogHeader>
              <form className="space-y-4" onSubmit={handleCreate}>
                <div className="space-y-1.5">
                  <Label htmlFor="sn">Student number</Label>
                  <Input id="sn" value={sn} onChange={(e) => setSn(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="fn">Full name</Label>
                  <Input id="fn" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="em">Email</Label>
                  <Input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={busy}>
                    {busy ? "Creating…" : "Create voter"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Upload className="mr-1.5 h-4 w-4" /> Bulk import
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Bulk import voters (CSV)</DialogTitle>
                <DialogDescription>
                  One voter per line: <code>student_number, full_name, email</code>. A header row is optional.
                </DialogDescription>
              </DialogHeader>
              <form className="space-y-4" onSubmit={handleBulk}>
                <Textarea
                  rows={8}
                  value={csv}
                  onChange={(e) => setCsv(e.target.value)}
                  placeholder={"S20240001, Ada Lovelace, ada@uni.edu\nS20240002, Grace Hopper, grace@uni.edu"}
                  className="font-mono text-xs"
                />
                <DialogFooter>
                  <Button type="submit" disabled={busy}>
                    {busy ? "Importing…" : "Import voters"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {links.length > 0 && (
        <div className="rounded-xl border border-border bg-muted/30 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Setup links — share these with the voters (valid 48h)
          </p>
          <ul className="space-y-2">
            {links.map((l, i) => (
              <li key={i} className="flex items-center gap-2">
                <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm">{l.label}</span>
                <code className="hidden max-w-[280px] truncate rounded bg-background px-2 py-1 text-xs sm:inline">
                  {l.url}
                </code>
                <Button size="sm" variant="ghost" onClick={() => copy(l.url)}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Voter</TableHead>
              <TableHead>Student #</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && voters.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No voters yet. Add one to get started.
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
                <TableCell>
                  {v.hasPendingSetup ? (
                    <Badge variant="outline">Pending setup</Badge>
                  ) : v.isActive ? (
                    <Badge variant="secondary">Active</Badge>
                  ) : (
                    <Badge variant="outline">Inactive</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Switch checked={v.isActive} onCheckedChange={(c) => toggleActive(v.id, c)} />
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => reissue(v.id, `${v.fullName} (${v.email})`)}
                  >
                    <Link2 className="mr-1 h-3.5 w-3.5" /> Setup link
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => softDelete(v.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
