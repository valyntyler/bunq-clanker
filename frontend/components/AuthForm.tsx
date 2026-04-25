"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  authOAuth,
  login,
  register,
  registerWithBunq,
  setToken,
} from "@/lib/auth";
import { BACKEND_URL } from "@/lib/api";

type Provider = "bunq" | "google" | "email";

/** Three sign-in / sign-up paths, presented as discrete option cards
 *  rather than tabs. The user picks an option and the relevant inline form
 *  expands underneath — same shape on /login and /register, with copy and
 *  the submit handler swapping based on `mode`. */
export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/";

  // Email opens by default on /login (judges typing the demo creds), Bunq
  // on /register (the "wow" path that mints a fresh sandbox account).
  const [picked, setPicked] = useState<Provider | null>(
    mode === "login" ? "email" : null,
  );

  return (
    <main className="flex flex-1 flex-col items-center px-6 py-16">
      <div className="w-full max-w-md space-y-8">
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
              ? "Sign in with your Bunq sandbox account, with Google, or with your email."
              : "Three paths. Bunq mints you a fresh sandbox account so /balance and /invest hit your own money. Google is one-click. Email is the classic."}
          </p>
        </header>

        {mode === "login" && <DemoCredentialsBanner onPrefill={setPicked} />}

        <div className="space-y-3">
          <OptionCard
            id="bunq"
            picked={picked}
            onPick={setPicked}
            glyph="b"
            title={mode === "login" ? "Continue with Bunq" : "Sign up with Bunq"}
            tagline={
              mode === "login"
                ? "Re-attach your saved sandbox key."
                : "Mints a fresh sandbox user with a Main + Investment Pot."
            }
            recommended={mode === "register"}
          >
            {picked === "bunq" && <BunqPanel mode={mode} next={next} />}
          </OptionCard>

          <OptionCard
            id="google"
            picked={picked}
            onPick={setPicked}
            glyph="G"
            title={
              mode === "login" ? "Continue with Google" : "Sign up with Google"
            }
            tagline="One-click via your Google account."
          >
            {picked === "google" && <GooglePanel mode={mode} next={next} />}
          </OptionCard>

          <OptionCard
            id="email"
            picked={picked}
            onPick={setPicked}
            glyph="@"
            title={
              mode === "login" ? "Continue with email" : "Sign up with email"
            }
            tagline="Classic email + password."
          >
            {picked === "email" && <EmailPanel mode={mode} next={next} />}
          </OptionCard>
        </div>

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

// ── Shared option card ────────────────────────────────────────────────

function OptionCard({
  id,
  picked,
  onPick,
  glyph,
  title,
  tagline,
  recommended,
  children,
}: {
  id: Provider;
  picked: Provider | null;
  onPick: (p: Provider) => void;
  glyph: string;
  title: string;
  tagline: string;
  recommended?: boolean;
  children?: React.ReactNode;
}) {
  const open = picked === id;
  return (
    <div
      className="overflow-hidden rounded-2xl"
      style={{
        background: open ? "var(--bunq-surface)" : "var(--bunq-surface-2)",
        border: open
          ? "1px solid rgba(181,255,0,0.30)"
          : "1px solid var(--bunq-border)",
        transition: "background 120ms ease, border-color 120ms ease",
      }}
    >
      <button
        type="button"
        onClick={() => onPick(id)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-black"
          style={{
            background: open ? "var(--bunq-green)" : "var(--bunq-surface)",
            color: open ? "#0a0d05" : "var(--bunq-text)",
            border: open ? "none" : "1px solid var(--bunq-border-strong)",
          }}
        >
          {glyph}
        </span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-[var(--bunq-text)]">
              {title}
            </span>
            {recommended && (
              <span
                className="rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]"
                style={{
                  background: "var(--bunq-green-soft)",
                  color: "var(--bunq-green)",
                }}
              >
                recommended
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--bunq-muted)]">
            {tagline}
          </div>
        </div>
        <span
          className="font-mono text-xs"
          style={{ color: open ? "var(--bunq-green)" : "var(--bunq-faint)" }}
        >
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <div
          className="px-4 pb-4"
          style={{ borderTop: "1px solid var(--bunq-border)" }}
        >
          <div className="pt-3">{children}</div>
        </div>
      )}
    </div>
  );
}

// ── Demo credentials banner (login screen only) ───────────────────────

function DemoCredentialsBanner({
  onPrefill,
}: {
  onPrefill: (p: Provider) => void;
}) {
  const [creds, setCreds] = useState<{ email: string; password: string } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`${BACKEND_URL}/auth/demo-credentials`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j) setCreds(j);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!creds) return null;
  return (
    <div
      className="rounded-2xl p-3 text-xs"
      style={{
        background: "rgba(181,255,0,0.06)",
        border: "1px solid rgba(181,255,0,0.30)",
      }}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-green)]">
        live demo · public sandbox account
      </div>
      <p className="mt-1 leading-relaxed text-[var(--bunq-text)]">
        Pre-loaded with a Bunq sandbox link and €1,000 in the Investment Pot.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code
          className="bunq-numeral rounded-md px-2 py-1 font-mono text-[11px]"
          style={{
            background: "var(--bunq-surface-2)",
            color: "var(--bunq-text)",
            border: "1px solid var(--bunq-border)",
          }}
        >
          {creds.email}
        </code>
        <code
          className="bunq-numeral rounded-md px-2 py-1 font-mono text-[11px]"
          style={{
            background: "var(--bunq-surface-2)",
            color: "var(--bunq-text)",
            border: "1px solid var(--bunq-border)",
          }}
        >
          {creds.password}
        </code>
        <button
          type="button"
          onClick={() => {
            onPrefill("email");
            // Surface to email panel via a custom event the panel listens to.
            window.dispatchEvent(
              new CustomEvent("sauron-prefill-demo", { detail: creds }),
            );
          }}
          className="ml-auto rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em]"
          style={{ background: "var(--bunq-green)", color: "#0a0d05" }}
        >
          use these ↗
        </button>
      </div>
    </div>
  );
}

// ── Bunq panel ────────────────────────────────────────────────────────

function BunqPanel({
  mode,
  next,
}: {
  mode: "login" | "register";
  next: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // For login mode we don't have a "log in with Bunq" path (Bunq sandbox
  // doesn't expose OIDC); instead we tell users to sign in with whatever
  // method they used to register, and link Bunq from settings later.
  if (mode === "login") {
    return (
      <p className="text-[12px] leading-relaxed text-[var(--bunq-muted)]">
        Bunq sandbox doesn&apos;t support OIDC sign-in yet. Sign in with the
        email or Google account you used to register, then attach (or
        re-attach) a Bunq sandbox key from{" "}
        <span className="font-mono text-[var(--bunq-text)]">Settings →
        Bunq</span>.
      </p>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await registerWithBunq({
        email: email || undefined,
        displayName: displayName || undefined,
      });
      setToken(res.token);
      router.replace(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-[12px] leading-relaxed text-[var(--bunq-muted)]">
        We&apos;ll mint a fresh Bunq sandbox user, create a{" "}
        <span className="text-[var(--bunq-text)]">Main</span> + an{" "}
        <span className="text-[var(--bunq-text)]">Investment Pot</span>, and
        store the API key on your Sauron account.
      </p>
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
      {error && <ErrorBanner message={error} />}
      <SubmitButton pending={pending} disabled={false}>
        {pending ? "Provisioning sandbox…" : "Create Bunq sandbox account"}
      </SubmitButton>
    </form>
  );
}

// ── Google panel ──────────────────────────────────────────────────────

function GooglePanel({
  mode,
  next,
}: {
  mode: "login" | "register";
  next: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await authOAuth({
        provider: "google",
        email,
        displayName,
        mode,
      });
      setToken(res.token);
      router.replace(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field
        label="Google email"
        type="email"
        value={email}
        onChange={setEmail}
        autoFocus
        disabled={pending}
        placeholder="you@gmail.com"
      />
      {mode === "register" && (
        <Field
          label="Display name (optional)"
          type="text"
          value={displayName}
          onChange={setDisplayName}
          disabled={pending}
          placeholder="Your name"
        />
      )}
      <p className="px-1 text-[11px] text-[var(--bunq-faint)]">
        Demo OAuth: in production we&apos;d verify a real OIDC id_token from
        Google; here we trust the email you enter.
      </p>
      {error && <ErrorBanner message={error} />}
      <SubmitButton pending={pending} disabled={!email.trim()}>
        {pending
          ? "Working…"
          : mode === "login"
            ? "Sign in with Google"
            : "Create account with Google"}
      </SubmitButton>
    </form>
  );
}

// ── Email panel ───────────────────────────────────────────────────────

function EmailPanel({
  mode,
  next,
}: {
  mode: "login" | "register";
  next: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Listen for the demo banner's "use these" event and prefill the form.
  useEffect(() => {
    function onPrefill(e: Event) {
      const detail = (e as CustomEvent).detail as
        | { email: string; password: string }
        | undefined;
      if (detail) {
        setEmail(detail.email);
        setPassword(detail.password);
      }
    }
    window.addEventListener("sauron-prefill-demo", onPrefill as EventListener);
    return () =>
      window.removeEventListener(
        "sauron-prefill-demo",
        onPrefill as EventListener,
      );
  }, []);

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

  const canSubmit = !!email.trim() && password.length >= (mode === "register" ? 8 : 1);

  return (
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
        placeholder={mode === "register" ? "8+ characters" : "••••••••"}
      />
      {error && <ErrorBanner message={error} />}
      <SubmitButton pending={pending} disabled={!canSubmit}>
        {pending
          ? "Working…"
          : mode === "login"
            ? "Sign in"
            : "Create account"}
      </SubmitButton>
    </form>
  );
}

// ── Shared atoms ──────────────────────────────────────────────────────

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

function SubmitButton({
  pending,
  disabled,
  children,
}: {
  pending: boolean;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="bunq-glow w-full rounded-full px-5 py-3 text-sm font-bold disabled:opacity-50"
      style={{ background: "var(--bunq-green)", color: "#0a0d05" }}
    >
      {children}
    </button>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      className="rounded-2xl px-4 py-2 text-xs"
      style={{
        background: "var(--bunq-bad-soft)",
        color: "var(--bunq-bad)",
        border: "1px solid rgba(255,91,107,0.18)",
      }}
    >
      {message}
    </div>
  );
}
