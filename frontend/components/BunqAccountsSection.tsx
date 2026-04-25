"use client";

import { useEffect, useState } from "react";
import { DataProvenance } from "@/components/DataProvenance";
import {
  meBunqAccounts,
  meBunqActivity,
  type BunqAccount,
  type BunqAccountsList,
  type BunqPayment,
} from "@/lib/api";

export function BunqAccountsSection() {
  const [data, setData] = useState<BunqAccountsList | null>(null);
  const [payments, setPayments] = useState<BunqPayment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeAccount, setActiveAccount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([meBunqAccounts(), meBunqActivity({ count: 25 })])
      .then(([accs, act]) => {
        if (!alive) return;
        setData(accs);
        setPayments(act.payments);
      })
      .catch((e) => alive && setError(String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <section>
        <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
          Bunq accounts
        </h2>
        <div
          className="rounded-2xl p-4 text-xs text-[var(--bunq-muted)]"
          style={{
            background: "var(--bunq-surface)",
            border: "1px solid var(--bunq-border)",
          }}
        >
          Loading from Bunq sandbox…
        </div>
      </section>
    );
  }

  if (error || !data) {
    const is404 = (error ?? "").includes("404");
    return (
      <section>
        <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
          Bunq accounts
        </h2>
        <div
          className="rounded-2xl p-4 text-xs"
          style={{
            background: "var(--bunq-surface)",
            border: `1px solid ${is404 ? "var(--bunq-border)" : "rgba(255,138,138,0.25)"}`,
            color: is404 ? "var(--bunq-muted)" : "#ff8a8a",
          }}
        >
          {is404 ? (
            <>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
                endpoint not deployed
              </div>
              <p className="mt-1 leading-snug">
                The <code>/me/bunq/*</code> routes weren't registered when the
                backend started. Restart the FastAPI server to pick them up:
                <code className="ml-1 rounded px-1.5 py-0.5 font-mono text-[11px]"
                  style={{ background: "var(--bunq-surface-2)" }}>
                  pkill -f &quot;uvicorn backend.main&quot; &amp;&amp; uvicorn backend.main:app --reload
                </code>
              </p>
            </>
          ) : (
            <>Bunq sandbox is offline or unauthenticated. ({error ?? "unknown"})</>
          )}
        </div>
      </section>
    );
  }

  const filtered =
    activeAccount === null
      ? payments
      : payments.filter((p) => p.account_id === activeAccount);

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
            Bunq accounts
          </h2>
          <DataProvenance
            kind="bunq_accounts"
            detail={`${data.summary.count} accounts`}
          />
        </div>
        <span className="font-mono text-[10px] text-[var(--bunq-muted)]">
          live · sandbox · €
          {data.summary.total_eur.toLocaleString(undefined, {
            maximumFractionDigits: 2,
          })}
        </span>
      </div>

      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
        {data.accounts.map((a) => (
          <AccountCard
            key={a.id}
            account={a}
            active={activeAccount === a.id}
            onClick={() =>
              setActiveAccount(activeAccount === a.id ? null : a.id)
            }
          />
        ))}
      </div>

      <div className="mt-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
              {activeAccount === null
                ? "Recent activity (all accounts)"
                : `Recent activity · ${
                    data.accounts.find((a) => a.id === activeAccount)
                      ?.description || "account"
                  }`}
            </h3>
            <DataProvenance kind="bunq_payments" />
          </div>
          {activeAccount !== null && (
            <button
              onClick={() => setActiveAccount(null)}
              className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--bunq-muted)] hover:text-[var(--bunq-text)]"
            >
              clear
            </button>
          )}
        </div>
        <div
          className="rounded-2xl"
          style={{
            background: "var(--bunq-surface)",
            border: "1px solid var(--bunq-border)",
          }}
        >
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-xs text-[var(--bunq-muted)]">
              No payments yet — invest in a ticker to see one appear here.
            </div>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--bunq-border)" }}>
              {filtered.slice(0, 12).map((p) => (
                <li
                  key={`${p.account_id}-${p.id}`}
                  className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-[var(--bunq-text)]">
                      {p.description || p.counterparty || "—"}
                    </span>
                    <span className="ml-2 font-mono text-[10px] text-[var(--bunq-faint)]">
                      {p.created?.slice(0, 16) ?? ""}
                    </span>
                  </span>
                  <span
                    className="bunq-numeral shrink-0 font-mono text-[12px]"
                    style={{
                      color:
                        p.amount > 0
                          ? "var(--bunq-green)"
                          : "var(--bunq-text)",
                    }}
                  >
                    {p.amount > 0 ? "+" : ""}
                    €
                    {Math.abs(p.amount).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function AccountCard({
  account,
  active,
  onClick,
}: {
  account: BunqAccount;
  active: boolean;
  onClick: () => void;
}) {
  const tag = account.is_main
    ? "main"
    : account.is_default_pot
      ? "pot"
      : account.is_ticker_pot
        ? account.ticker ?? "pot"
        : "pot";
  const accent = account.is_ticker_pot;
  return (
    <button
      onClick={onClick}
      className="rounded-2xl p-3 text-left transition hover:brightness-110"
      style={{
        background: accent
          ? "linear-gradient(160deg, rgba(181,255,0,0.06), var(--bunq-surface))"
          : "var(--bunq-surface)",
        border: active
          ? "1px solid var(--bunq-green)"
          : `1px solid ${accent ? "rgba(181,255,0,0.18)" : "var(--bunq-border)"}`,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[12px] text-[var(--bunq-text)]">
          {account.description || `Account ${account.id}`}
        </span>
        <span
          className="rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]"
          style={{
            background: accent
              ? "var(--bunq-green-soft)"
              : "var(--bunq-surface-2)",
            color: accent ? "var(--bunq-green)" : "var(--bunq-muted)",
          }}
        >
          {tag}
        </span>
      </div>
      <div
        className="bunq-numeral mt-1 text-2xl font-black"
        style={{ color: accent ? "var(--bunq-green)" : "var(--bunq-text)" }}
      >
        €
        {account.balance.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </div>
      {account.iban && (
        <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--bunq-faint)]">
          {account.iban}
        </div>
      )}
    </button>
  );
}
