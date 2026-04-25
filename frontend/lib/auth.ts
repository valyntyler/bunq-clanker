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
  auth_provider?: "email" | "google" | "apple" | "bunq" | string;
  display_name?: string;
  bunq_connected?: boolean;
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

/** Sign in / sign up via Google or Apple iCloud. The frontend collects the
 *  email + display name; in production we'd verify a real OIDC id_token
 *  here. The same email re-logs an existing user in. */
export async function authOAuth(
  provider: "google" | "apple",
  email: string,
  displayName?: string
): Promise<{ token: string; user: AuthUser }> {
  const r = await fetch(`${BACKEND_URL}/auth/oauth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider, email, display_name: displayName }),
  });
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

/** Mint a fresh Bunq sandbox account in one shot. The new sandbox user's
 *  API key, monetary-account ids, and display name are all stored on the
 *  Sauron User row, so /balance / /invest immediately use this account. */
export async function registerWithBunq(opts?: {
  email?: string;
  displayName?: string;
}): Promise<{ token: string; user: AuthUser }> {
  const r = await fetch(`${BACKEND_URL}/auth/register/bunq`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: opts?.email,
      display_name: opts?.displayName,
    }),
  });
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

/** Attach an existing Bunq sandbox API key to the currently signed-in
 *  Sauron user. Used when a user signed up via email/Google/Apple and
 *  later wants their /balance to hit their own account. */
export async function connectBunq(
  apiKey: string
): Promise<{ token: string; user: AuthUser }> {
  const t = getToken();
  if (!t) throw new Error("not authenticated");
  const r = await fetch(`${BACKEND_URL}/me/bunq/connect`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${t}`,
    },
    body: JSON.stringify({ api_key: apiKey }),
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
