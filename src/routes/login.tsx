import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ShieldCheck, ArrowRight, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in · SEVS" },
      { name: "description", content: "Sign in to SEVS with your credentials and one-time code." },
    ],
  }),
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"creds" | "otp">("creds");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleCreds(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (signInError) {
      setError("Invalid credentials. Please check your email and password.");
      return;
    }
    setStep("otp");
  }

  function handleOtp(e: React.FormEvent) {
    e.preventDefault();
    // Demo 2FA step (RFC 6238 TOTP UI). Session is already established above.
    navigate({ to: "/dashboard" });
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
            “One voter, one ballot — encrypted, signed, and never linked back to you.”
          </p>
          <p className="mt-4 text-sm text-primary-foreground/70">
            SEVS protects ballots with hash-chained audit records and authenticated
            sessions. Two-factor verification adds a second layer of protection.
          </p>
        </div>
        <div className="text-xs text-primary-foreground/60">
          Connection secured · TLS 1.3 · Session expires after inactivity
        </div>
      </div>

      <div className="flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-sm">
          <Link to="/" className="mb-8 flex items-center gap-2 lg:hidden">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold">SEVS</span>
          </Link>

          {step === "creds" ? (
            <>
              <h1 className="text-2xl font-semibold tracking-tight">Sign in to vote</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Use the email and password provided to you.
              </p>
              <form className="mt-8 space-y-4" onSubmit={handleCreds}>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@sevs.vote"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw">Password</Label>
                  <Input
                    id="pw"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Signing in…" : <>Continue <ArrowRight className="ml-1 h-4 w-4" /></>}
                </Button>
              </form>
              <p className="mt-6 text-xs text-muted-foreground">
                By signing in you accept the election rules and the audit policy.
              </p>
            </>
          ) : (
            <>
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                <KeyRound className="h-5 w-5" />
              </div>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight">Two-factor code</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Enter any 6-digit code to complete the demo two-factor step.
              </p>
              <form className="mt-8 space-y-6" onSubmit={handleOtp}>
                <div className="flex justify-center">
                  <InputOTP maxLength={6} value={otp} onChange={setOtp}>
                    <InputOTPGroup>
                      <InputOTPSlot index={0} />
                      <InputOTPSlot index={1} />
                      <InputOTPSlot index={2} />
                    </InputOTPGroup>
                    <InputOTPSeparator />
                    <InputOTPGroup>
                      <InputOTPSlot index={3} />
                      <InputOTPSlot index={4} />
                      <InputOTPSlot index={5} />
                    </InputOTPGroup>
                  </InputOTP>
                </div>
                <Button type="submit" className="w-full" disabled={otp.length < 6}>
                  Verify & sign in
                </Button>
                <button
                  type="button"
                  className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
                  onClick={async () => {
                    await supabase.auth.signOut();
                    setStep("creds");
                    setOtp("");
                  }}
                >
                  Use a different account
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
