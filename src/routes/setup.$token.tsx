import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ShieldCheck, KeyRound, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { validateSetupToken, completeSetup } from "@/lib/sevs-setup.functions";

export const Route = createFileRoute("/setup/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Set up your account · SEVS" },
      { name: "description", content: "Activate your SEVS voter account and choose a password." },
    ],
  }),
  component: Setup,
});

const REASONS: Record<string, string> = {
  invalid: "This setup link is not valid.",
  used: "This setup link has already been used.",
  expired: "This setup link has expired. Ask an administrator for a new one.",
  inactive: "This account is inactive. Contact an administrator.",
};

function Setup() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const validate = useServerFn(validateSetupToken);
  const finish = useServerFn(completeSetup);

  const { data, isLoading } = useQuery({
    queryKey: ["setup-token", token],
    queryFn: () => validate({ data: { token } }),
    retry: false,
  });

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    const res = await finish({ data: { token, password } });
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDone(true);
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden gradient-trust p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary-foreground/15 backdrop-blur">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <span className="text-sm font-semibold">SEVS</span>
        </Link>
        <div>
          <p className="text-2xl font-semibold leading-snug">
            Activate your voter account
          </p>
          <p className="mt-4 text-sm text-primary-foreground/70">
            Choose a password to finish setting up your account. Your setup link is
            single-use and expires 48 hours after it was issued.
          </p>
        </div>
        <div className="text-xs text-primary-foreground/60">Connection secured · TLS 1.3</div>
      </div>

      <div className="flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-sm">
          <Link to="/" className="mb-8 flex items-center gap-2 lg:hidden">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold">SEVS</span>
          </Link>

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Checking your setup link…</p>
          ) : done ? (
            <div className="text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-success">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <h1 className="mt-5 text-2xl font-semibold tracking-tight">You're all set</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Your password has been saved. You can now sign in to vote.
              </p>
              <Button className="mt-6 w-full" onClick={() => navigate({ to: "/login" })}>
                Go to sign in
              </Button>
            </div>
          ) : data && !data.valid ? (
            <div className="text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <AlertTriangle className="h-7 w-7" />
              </div>
              <h1 className="mt-5 text-2xl font-semibold tracking-tight">Link unavailable</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {REASONS[data.reason] ?? "This setup link cannot be used."}
              </p>
              <Button variant="outline" className="mt-6 w-full" onClick={() => navigate({ to: "/login" })}>
                Back to sign in
              </Button>
            </div>
          ) : (
            <>
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                <KeyRound className="h-5 w-5" />
              </div>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight">Choose a password</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {data?.email ? `Setting up ${data.email}` : "Set a password to activate your account."}
              </p>
              <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
                <div className="space-y-1.5">
                  <Label htmlFor="pw">New password</Label>
                  <Input
                    id="pw"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw2">Confirm password</Label>
                  <Input
                    id="pw2"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                  />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Saving…" : "Activate account"}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
