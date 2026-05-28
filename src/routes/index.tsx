import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck, Lock, FileCheck2, Activity, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SEVS — Secure Electronic Voting System" },
      {
        name: "description",
        content:
          "End-to-end encrypted student elections with tamper-evident audit logs and verifiable receipts.",
      },
      { property: "og:title", content: "SEVS — Secure Electronic Voting System" },
      {
        property: "og:description",
        content: "Vote confidentially. Verify publicly. SEVS guarantees ballot secrecy, integrity, and auditability.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between px-6 py-5 md:px-12">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-md gradient-trust text-primary-foreground">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <span className="text-sm font-semibold tracking-tight">SEVS</span>
        </div>
        <nav className="flex items-center gap-2">
          <Link to="/login">
            <Button variant="ghost" size="sm">Sign in</Button>
          </Link>
          <Link to="/login">
            <Button size="sm">
              Cast your vote <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </Link>
        </nav>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 surface-grid opacity-60" />
        <div className="relative mx-auto max-w-5xl px-6 pt-16 pb-24 md:px-12 md:pt-24 md:pb-32">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
            IEEE 830 · ISO/IEC 25010 · OWASP-aligned
          </span>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-foreground md:text-6xl">
            Vote confidentially.
            <br />
            <span className="bg-gradient-to-r from-primary to-success bg-clip-text text-transparent">
              Verify publicly.
            </span>
          </h1>
          <p className="mt-6 max-w-2xl text-base text-muted-foreground md:text-lg">
            SEVS is a secure electronic voting system for student internal elections.
            Ballots are encrypted with AES-256, signed with RSA-2048, and recorded in a
            tamper-evident, hash-chained audit log — so every voter can trust the result.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/login">
              <Button size="lg">
                Sign in to vote <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </Link>
            <Link to="/results">
              <Button size="lg" variant="outline">
                View past results
              </Button>
            </Link>
          </div>

          <div className="mt-16 grid gap-4 md:grid-cols-3">
            {[
              {
                icon: Lock,
                title: "End-to-end encrypted",
                body: "AES-256 ballot encryption with per-election RSA-2048 keypairs. No operator can read your vote.",
              },
              {
                icon: FileCheck2,
                title: "Verifiable receipts",
                body: "After casting, you receive a signed receipt to confirm your ballot was counted — without revealing how you voted.",
              },
              {
                icon: Activity,
                title: "Tamper-evident log",
                body: "Every event is appended to a SHA-256 hash chain. Any modification breaks the chain and is detected.",
              },
            ].map((f) => (
              <div
                key={f.title}
                className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <f.icon className="h-4.5 w-4.5" />
                </div>
                <h3 className="mt-4 text-sm font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border px-6 py-6 text-xs text-muted-foreground md:px-12">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
          <span>© 2026 SEVS — Tutored academic project</span>
          <span>v1.0 · Draft specification</span>
        </div>
      </footer>
    </div>
  );
}
