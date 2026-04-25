"use client";

import { useRouter } from "next/navigation";
import { clearToken, useUser } from "@/lib/auth";

export function TopBar() {
  const { user } = useUser();
  const router = useRouter();
  if (!user) return null;
  return (
    <div
      className="flex items-center justify-between border-b px-5 py-2.5"
      style={{
        borderColor: "var(--bunq-border)",
        background: "rgba(8,8,10,0.7)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black"
          style={{ background: "var(--bunq-green)", color: "#0a0d05" }}
        >
          b
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--bunq-green)]">
          Sauron Wallet
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-mono text-[11px] text-[var(--bunq-muted)]">
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
