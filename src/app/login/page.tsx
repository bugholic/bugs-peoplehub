"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { Alert, Avatar, Button, Field, Input } from "@/components/ui";
import { Logo } from "@/components/nav-sidebar";

const DEMO_ACCOUNTS = [
  { email: "admin@peoplehub.test", name: "Admin", role: "Full access" },
  { email: "manager@peoplehub.test", name: "Manager", role: "Approves their team" },
  { email: "employee@peoplehub.test", name: "Employee", role: "Self-service" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiFetch("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <section className="relative hidden overflow-hidden bg-night p-12 text-white lg:flex lg:flex-col">
        <Logo />
        <div aria-hidden className="pointer-events-none absolute -right-24 top-1/4 size-[420px] rounded-full bg-brand/40 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-20 left-10 size-64 rounded-full bg-marigold/25 blur-3xl" />

        <div className="relative mt-auto max-w-md">
          <h1 className="font-display text-5xl font-semibold leading-[1.05] tracking-tight">Your whole team, in one calm place.</h1>
          <p className="mt-5 text-lg leading-relaxed text-white/60">
            Check in, request time off, and find anyone in the company without chasing a spreadsheet.
          </p>
          <div className="mt-10 flex items-center gap-3">
            <div className="flex -space-x-2">
              {["Asha Rao", "Vikram Shah", "Neha Iyer", "Rohan Das"].map((n) => (
                <Avatar key={n} name={n} size="md" className="ring-2 ring-night" />
              ))}
            </div>
            <p className="text-sm text-white/50">Directory, leave and attendance together</p>
          </div>
        </div>
      </section>

      {/* Form */}
      <section className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <Logo className="mb-10 lg:hidden" />
          <h2 className="font-display text-3xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-2 text-ink-2">Use your work email to continue.</p>

          <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
            <Field label="Email">
              <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
            </Field>
            <Field label="Password">
              <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {error && <Alert>{error}</Alert>}
            <Button type="submit" disabled={loading} className="mt-2 h-11 w-full">
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <div className="mt-10">
            <p className="text-[13px] font-medium text-ink-2">
              Try a demo account <span className="text-ink-3">(password Password@123)</span>
            </p>
            <div className="mt-3 grid gap-2">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.email}
                  type="button"
                  onClick={() => {
                    setEmail(a.email);
                    setPassword("Password@123");
                  }}
                  className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:border-brand/40 hover:bg-brand-soft/50"
                >
                  <Avatar name={a.name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink">{a.name}</span>
                    <span className="block truncate text-xs text-ink-3">{a.email}</span>
                  </span>
                  <span className="text-xs text-ink-3">{a.role}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
