"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { login, register, setToken } from "@/lib/auth";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res =
        mode === "login"
          ? await login(email, password)
          : await register(email, password);
      setToken(res.token);
      router.replace(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center px-6 py-16">
      <div className="w-full max-w-sm space-y-8">
        <header>
          <div className="flex items-center gap-2">
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[15px] font-black"
              style={{ background: "var(--bunq-green)", color: "#0a0d05" }}
            >
              b
            </span>
            <span className="bunq-numeral font-mono text-xs uppercase tracking-[0.22em] text-[var(--bunq-green)]">
              Sauron Wallet
            </span>
          </div>
          <h1 className="mt-6 bunq-numeral text-4xl font-black leading-[1.05] tracking-tight">
            {mode === "login" ? "Welcome back" : "Make an account"}
          </h1>
          <p className="mt-2 text-sm text-[var(--bunq-muted)]">
            {mode === "login"
              ? "Sign in to run multimodal analyses, paste evidence, chat with the analyst, and move money."
              : "8+ characters. Use a real email so the demo can address you. We won't email."}
          </p>
        </header>

        <form onSubmit={submit} className="space-y-3">
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            autoFocus
            disabled={pending}
            placeholder="you@example.com"
          />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            disabled={pending}
            placeholder="••••••••"
          />
          {error && (
            <div
              className="rounded-2xl px-4 py-2 text-xs"
              style={{
                background: "var(--bunq-bad-soft)",
                color: "var(--bunq-bad)",
                border: "1px solid rgba(255,91,107,0.18)",
              }}
            >
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={pending || !email.trim() || password.length < 1}
            className="bunq-glow w-full rounded-full px-5 py-3 text-sm font-bold disabled:opacity-50"
            style={{ background: "var(--bunq-green)", color: "#0a0d05" }}
          >
            {pending ? "Working…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <div className="text-center text-xs text-[var(--bunq-muted)]">
          {mode === "login" ? (
            <>
              No account?{" "}
              <Link
                href={`/register${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}
                style={{ color: "var(--bunq-green)" }}
              >
                Create one
              </Link>
            </>
          ) : (
            <>
              Already have one?{" "}
              <Link
                href={`/login${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}
                style={{ color: "var(--bunq-green)" }}
              >
                Sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  autoFocus,
  disabled,
  placeholder,
}: {
  label: string;
  type: "email" | "password";
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete={type === "password" ? "current-password" : "email"}
        className="bunq-numeral mt-1 w-full rounded-2xl px-4 py-3 outline-none disabled:opacity-50"
        style={{
          background: "var(--bunq-surface-2)",
          border: "1px solid var(--bunq-border-strong)",
          color: "var(--bunq-text)",
        }}
      />
    </label>
  );
}
