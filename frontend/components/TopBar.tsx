"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearToken, useUser } from "@/lib/auth";

export function TopBar() {
  const { user } = useUser();
  const router = useRouter();
  const pathname = usePathname();
  if (!user) return null;
  return (
    <div
      className="sticky top-0 z-40 flex items-center justify-between border-b px-5 py-2.5"
      style={{
        borderColor: "var(--bunq-border)",
        background: "rgba(8,8,10,0.78)",
        backdropFilter: "blur(8px)",
      }}
    >
      <Link href="/" className="flex items-center gap-2">
        <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black"
          style={{ background: "var(--bunq-green)", color: "#0a0d05" }}
        >
          b
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--bunq-green)]">
          Sauron Wallet
        </span>
      </Link>
      <div className="flex items-center gap-2">
        <NavLink href="/" label="Analyze" active={pathname === "/"} />
        <NavLink
          href="/dashboard"
          label="Dashboard"
          active={pathname?.startsWith("/dashboard") ?? false}
        />
        <span className="ml-3 hidden font-mono text-[11px] text-[var(--bunq-muted)] sm:inline">
          {user.email}
        </span>
        <button
          onClick={() => {
            clearToken();
            router.replace("/login");
          }}
          className="rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em]"
          style={{
            background: "var(--bunq-surface-2)",
            border: "1px solid var(--bunq-border)",
            color: "var(--bunq-text)",
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

function NavLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className="rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em]"
      style={
        active
          ? { background: "var(--bunq-green-soft)", color: "var(--bunq-green)" }
          : { color: "var(--bunq-muted)" }
      }
    >
      {label}
    </Link>
  );
}
