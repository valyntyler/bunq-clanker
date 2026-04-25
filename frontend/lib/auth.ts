// Tiny auth client: token in localStorage + a useUser() hook that polls /auth/me.
// Intentionally NOT a Context — the API surface is small enough that a hook
// reading localStorage directly is simpler.

"use client";

import { useEffect, useState } from "react";
import { BACKEND_URL } from "./api";

const TOKEN_KEY = "sauron.token";

export interface AuthUser {
  id: string;
  email: string;
  created_at: string;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(t: string) {
  window.localStorage.setItem(TOKEN_KEY, t);
  // Notify same-tab listeners (storage event only fires across tabs).
  window.dispatchEvent(new Event("sauron-auth"));
}

export function clearToken() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new Event("sauron-auth"));
}

export async function login(
  email: string,
  password: string
): Promise<{ token: string; user: AuthUser }> {
  const r = await fetch(`${BACKEND_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

export async function register(
  email: string,
  password: string
): Promise<{ token: string; user: AuthUser }> {
  const r = await fetch(`${BACKEND_URL}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

export async function fetchMe(): Promise<AuthUser> {
  const t = getToken();
  if (!t) throw new Error("not authenticated");
  const r = await fetch(`${BACKEND_URL}/auth/me`, {
    headers: { authorization: `Bearer ${t}` },
  });
  if (!r.ok) {
    if (r.status === 401) clearToken();
    throw new Error((await r.json()).detail ?? r.statusText);
  }
  return r.json();
}

/** Hook: returns the current user (or null), and a `loading` flag. */
export function useUser(): { user: AuthUser | null; loading: boolean } {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const t = getToken();
      if (!t) {
        if (!cancelled) {
          setUser(null);
          setLoading(false);
        }
        return;
      }
      try {
        const u = await fetchMe();
        if (!cancelled) setUser(u);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const onChange = () => load();
    window.addEventListener("sauron-auth", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      cancelled = true;
      window.removeEventListener("sauron-auth", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  return { user, loading };
}
