"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import { useUser } from "@/lib/auth";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useUser();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?next=${encodeURIComponent(pathname || "/")}`);
    }
  }, [loading, user, router, pathname]);

  if (loading) {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
          checking auth…
        </div>
      </main>
    );
  }
  if (!user) return null;
  return <>{children}</>;
}
