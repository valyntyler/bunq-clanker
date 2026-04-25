"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  authOAuth,
  login,
  register,
  registerWithBunq,
  setToken,
} from "@/lib/auth";

type Provider = "email" | "google" | "apple" | "bunq";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/";

  const [provider, setProvider] = useState<Provider>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      let res: { token: string };
      if (provider === "email") {
        res =
          mode === "login"
            ? await login(email, password)
            : await register(email, password);
      } else if (provider === "google" || provider === "apple") {
        res = await authOAuth(provider, email, displayName);
      } else {
        // bunq — registers a fresh sandbox account
        res = await registerWithBunq({
          email: email || undefined,
          displayName: displayName || undefined,
        });
      }
      setToken(res.token);
      router.replace(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  // What this submit button actually does, label-wise.
  const ctaLabel: string = pending
    ? "Working…"
    : provider === "email"
      ? mode === "login"
        ? "Sign in"
        : "Create account"
      : provider === "google"
        ? "Continue with Google"
        : provider === "apple"
          ? "Continue with Apple"
          : "Create Bunq sandbox account";

  // Email / password validity per provider.
  const canSubmit: boolean = (() => {
    if (pending) return false;
    if (provider === "email") {
      return !!email.trim() && password.length >= 1;
    }
    if (provider === "google" || provider === "apple") {
      return !!email.trim();
    }
    // bunq — server-side mints a sandbox account; email is optional, but
    // if provided it must be valid.
    return true;
  })();

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
              ? "Sign in with your email, Google, Apple iCloud, or your Bunq sandbox account."
              : "Pick how you want to sign up. The Bunq path mints a fresh sandbox account so /balance and /invest hit your own money."}
          </p>
        </header>

        <ProviderTabs value={provider} onChange={setProvider} mode={mode} />

        <form onSubmit={submit} className="space-y-3">
          {provider === "email" && (
            <>
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
            </>
          )}

          {(provider === "google" || provider === "apple") && (
            <>
              <Field
                label={provider === "google" ? "Google email" : "iCloud email"}
                type="email"
                value={email}
                onChange={setEmail}
                autoFocus
                disabled={pending}
                placeholder={
                  provider === "google" ? "you@gmail.com" : "you@icloud.com"
                }
              />
              <Field
                label="Display name (optional)"
                type="text"
                value={displayName}
                onChange={setDisplayName}
                disabled={pending}
                placeholder="Your name"
              />
              <p className="px-1 text-[11px] text-[var(--bunq-faint)]">
                Demo OAuth: in production we'd verify a real OIDC id_token
                from {provider === "google" ? "Google" : "Apple"}; here we
                trust the email you enter.
              </p>
            </>
          )}

          {provider === "bunq" && (
            <>
              <div
                className="rounded-2xl p-4 text-xs"
                style={{
                  background:
                    "linear-gradient(160deg, rgba(181,255,0,0.08), var(--bunq-surface-2))",
                  border: "1px solid rgba(181,255,0,0.30)",
                  color: "var(--bunq-text)",
                }}
              >
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-green)]">
                  one-click bunq sandbox
                </div>
                <p className="mt-2 leading-relaxed">
                  We&apos;ll mint a fresh Bunq sandbox user, create a Main +
                  Investment Pot for you, and store the API key on your Sauron
                  account. The dashboard, /balance, and /invest will all use
                  your own Bunq account from then on.
                </p>
              </div>
              <Field
                label="Login email (optional)"
                type="email"
                value={email}
                onChange={setEmail}
                disabled={pending}
                placeholder="you@example.com"
              />
              <Field
                label="Display name (optional)"
                type="text"
                value={displayName}
                onChange={setDisplayName}
                disabled={pending}
                placeholder="Your name"
              />
            </>
          )}

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
            disabled={!canSubmit}
            className="bunq-glow w-full rounded-full px-5 py-3 text-sm font-bold disabled:opacity-50"
            style={{ background: "var(--bunq-green)", color: "#0a0d05" }}
          >
            {ctaLabel}
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

function ProviderTabs({
  value,
  onChange,
  mode,
}: {
  value: Provider;
  onChange: (p: Provider) => void;
  mode: "login" | "register";
}) {
  // The Bunq tab only mints a fresh sandbox user — exposing it on the
  // login screen would be surprising. Hide it there.
  const tabs: { id: Provider; label: string; glyph: string }[] = [
    { id: "email", label: "Email", glyph: "@" },
    { id: "google", label: "Google", glyph: "G" },
    { id: "apple", label: "iCloud", glyph: "" },
    ...(mode === "register"
      ? [{ id: "bunq" as Provider, label: "Bunq", glyph: "b" }]
      : []),
  ];
  return (
    <div
      className="flex gap-1 rounded-full p-1"
      style={{
        background: "var(--bunq-surface-2)",
        border: "1px solid var(--bunq-border)",
      }}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          type="button"
          className="flex-1 rounded-full px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] transition"
          style={
            value === t.id
              ? {
                  background: "var(--bunq-green-soft)",
                  color: "var(--bunq-green)",
                  border: "1px solid rgba(181,255,0,0.30)",
                }
              : {
                  background: "transparent",
                  color: "var(--bunq-muted)",
                  border: "1px solid transparent",
                }
          }
        >
          <span aria-hidden className="mr-1.5 opacity-80">
            {t.glyph}
          </span>
          {t.label}
        </button>
      ))}
    </div>
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
  type: "email" | "password" | "text";
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
        autoComplete={
          type === "password"
            ? "current-password"
            : type === "email"
              ? "email"
              : "off"
        }
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
