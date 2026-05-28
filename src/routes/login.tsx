import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ShieldCheck, ArrowRight, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
      { name: "description", content: "Sign in to SEVS with your student credentials and one-time code." },
    ],
  }),
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"creds" | "otp">("creds");
  const [otp, setOtp] = useState("");

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
            SEVS uses AES-256 ballot encryption and RSA-2048 signatures. Authentication
            is protected with a time-based one-time code (RFC 6238).
          </p>
        </div>
        <div className="text-xs text-primary-foreground/60">
          Connection secured · TLS 1.3 · Session expires after 15 minutes
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
                Use your university student ID and password.
              </p>
              <form
                className="mt-8 space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  setStep("otp");
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="sid">Student ID</Label>
                  <Input id="sid" placeholder="s1234567" autoComplete="username" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw">Password</Label>
                  <Input id="pw" type="password" autoComplete="current-password" required />
                </div>
                <Button type="submit" className="w-full">
                  Continue <ArrowRight className="ml-1 h-4 w-4" />
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
                Enter the 6-digit code from your authenticator app.
              </p>
              <form
                className="mt-8 space-y-6"
                onSubmit={(e) => {
                  e.preventDefault();
                  navigate({ to: "/dashboard" });
                }}
              >
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
                  onClick={() => setStep("creds")}
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
