"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/Modal";
import {
  bunqBalance,
  invest,
  meInvestments,
  type BunqBalance,
  type InvestmentRow,
  type InvestReceipt,
  type Report,
} from "@/lib/api";

type Tab = "invest" | "history";

export function InvestModal({
  report,
  open,
  onClose,
}: {
  report: Report;
  open: boolean;
  onClose: () => void;
}) {
  const defaultAmt = Math.max(
    25,
    Math.round((report.position_size_pct / 100) * 1000)
  );
  const MIN = 1;
  const MAX = 10_000;
  const [tab, setTab] = useState<Tab>("invest");
  const [amount, setAmount] = useState(defaultAmt);
  const [amountText, setAmountText] = useState(String(defaultAmt));

  function setAmountFromText(s: string) {
    setAmountText(s);
    const n = parseFloat(s.replace(/[^\d.,-]/g, "").replace(",", "."));
    if (!Number.isFinite(n)) return;
    setAmount(Math.max(MIN, Math.min(MAX, n)));
  }
  function setAmountFromSlider(n: number) {
    setAmount(n);
    setAmountText(String(n));
  }
  const [pending, setPending] = useState(false);
  const [receipt, setReceipt] = useState<InvestReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<BunqBalance | null>(null);

  // Investment history — loaded when the History tab is opened OR after a
  // successful invest so the user sees their fresh ticket land in the list.
  const [history, setHistory] = useState<InvestmentRow[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  // When set, the History tab renders a single ticket's detail panel
  // (same field layout as the post-invest receipt view) instead of the list.
  const [selectedRow, setSelectedRow] = useState<InvestmentRow | null>(null);

  // Reset transient state every time the modal opens, so a stale receipt or
  // error from a prior session doesn't ghost the next one. Without this the
  // receipt screen sticks around on re-open and the user can't invest again.
  useEffect(() => {
    if (!open) return;
    setTab("invest");
    setReceipt(null);
    setError(null);
    setPending(false);
    setSelectedRow(null);
    setAmount(defaultAmt);
    setAmountText(String(defaultAmt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, report.ticker]);

  // Live balance — refresh on open and after every successful invest.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    bunqBalance().then((b) => !cancelled && setBalance(b)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, receipt]);

  // Load history when its tab is opened OR right after a successful invest
  // so the just-created ticket shows up immediately.
  useEffect(() => {
    if (!open) return;
    if (tab !== "history" && !receipt) return;
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);
    meInvestments(true)
      .then((d) => !cancelled && setHistory(d.investments))
      .catch((e) => !cancelled && setHistoryError((e as Error).message))
      .finally(() => !cancelled && setHistoryLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, tab, receipt]);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const r = await invest(report.ticker, amount);
      setReceipt(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  function startAnother() {
    setReceipt(null);
    setError(null);
    setAmount(defaultAmt);
    setAmountText(String(defaultAmt));
    setTab("invest");
  }

  return (
    <Modal open={open} onClose={onClose} size="md" ariaLabel="Invest">
      <>
        {/* Tabs — always visible so users can flip between making a new
            investment and reviewing past tickets without closing the modal. */}
        <Tabs tab={tab} onChange={setTab} historyCount={history?.length ?? null} />

        {tab === "invest" && !receipt && (
          <InvestForm
            report={report}
            amount={amount}
            amountText={amountText}
            setAmountFromText={setAmountFromText}
            setAmountFromSlider={setAmountFromSlider}
            min={MIN}
            max={MAX}
            defaultAmt={defaultAmt}
            balance={balance}
            pending={pending}
            error={error}
            submit={submit}
            onClose={onClose}
          />
        )}

        {tab === "invest" && receipt && (
          <ReceiptView
            receipt={receipt}
            balance={balance}
            onAnother={startAnother}
            onShowHistory={() => setTab("history")}
            onClose={onClose}
          />
        )}

        {tab === "history" && !selectedRow && (
          <HistoryView
            history={history}
            loading={historyLoading}
            error={historyError}
            currentTicker={report.ticker}
            onMakeOne={() => setTab("invest")}
            onSelect={(row) => setSelectedRow(row)}
          />
        )}

        {tab === "history" && selectedRow && (
          <TicketDetailView
            row={selectedRow}
            onBack={() => setSelectedRow(null)}
            onClose={onClose}
          />
        )}
      </>
    </Modal>
  );
}

function Tabs({
  tab,
  onChange,
  historyCount,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
  historyCount: number | null;
}) {
  return (
    <div
      className="mb-4 flex items-center gap-1 rounded-full p-1"
      style={{
        background: "var(--bunq-surface-2)",
        border: "1px solid var(--bunq-border)",
      }}
    >
      <TabButton active={tab === "invest"} onClick={() => onChange("invest")} label="Invest" />
      <TabButton
        active={tab === "history"}
        onClick={() => onChange("history")}
        label={historyCount === null ? "History" : `History · ${historyCount}`}
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className="flex-1 rounded-full px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] transition"
      style={
        active
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
      {label}
    </button>
  );
}

function InvestForm({
  report,
  amount,
  amountText,
  setAmountFromText,
  setAmountFromSlider,
  min,
  max,
  defaultAmt,
  balance,
  pending,
  error,
  submit,
  onClose,
}: {
  report: Report;
  amount: number;
  amountText: string;
  setAmountFromText: (s: string) => void;
  setAmountFromSlider: (n: number) => void;
  min: number;
  max: number;
  defaultAmt: number;
  balance: BunqBalance | null;
  pending: boolean;
  error: string | null;
  submit: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-green)]">
        <BunqMark />
        <span className="text-[var(--bunq-muted)]">
          Move money · Main → Sauron · {report.ticker}
        </span>
      </div>
      <h2 className="mt-2 bunq-numeral text-3xl font-black">
        Invest €
        {amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
      </h2>
      <p className="mt-1 text-sm text-[var(--bunq-muted)]">
        Verdict <span className="font-semibold text-[var(--bunq-text)]">{report.verdict}</span>
        {" · "}
        recommended position {report.position_size_pct.toFixed(1)}%
      </p>

      {balance && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <BalancePill label="Main Wallet" value={balance.main} />
          <BalancePill label="Investment Pot" value={balance.pot} accent />
        </div>
      )}

      <div className="mt-5 flex items-center gap-2">
        <span className="bunq-numeral font-mono text-2xl font-black text-[var(--bunq-faint)]">
          €
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={amountText}
          onChange={(e) => setAmountFromText(e.target.value)}
          onBlur={() => setAmountFromText(String(amount))}
          className="bunq-numeral flex-1 rounded-2xl px-3 py-2.5 text-2xl font-black outline-none"
          style={{
            background: "var(--bunq-surface-2)",
            border: "1px solid var(--bunq-border-strong)",
            color: "var(--bunq-text)",
          }}
          aria-label="Investment amount in EUR"
        />
      </div>
      <div className="mt-2 flex gap-1.5">
        {[25, 100, 500, 1000].map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => setAmountFromSlider(q)}
            className="rounded-full px-3 py-1 font-mono text-[11px] hover:opacity-80"
            style={{
              background: "var(--bunq-surface-2)",
              border: "1px solid var(--bunq-border)",
              color: "var(--bunq-muted)",
            }}
          >
            €{q}
          </button>
        ))}
      </div>
      <input
        type="range"
        min={min}
        max={Math.min(max, Math.max(2000, defaultAmt * 5))}
        step={1}
        value={amount}
        onChange={(e) => setAmountFromSlider(parseInt(e.target.value))}
        className="mt-3 w-full accent-[var(--bunq-green)]"
      />
      <div className="flex justify-between font-mono text-[10px] text-[var(--bunq-faint)]">
        <span>€{min}</span>
        <span>up to €{max.toLocaleString()}</span>
      </div>
      {balance && amount > balance.main && (
        <div className="mt-2 text-[11px] text-[var(--bunq-warn)]">
          Main has €{balance.main.toFixed(2)} — we'll top-up from sandbox
          sugardaddy first.
        </div>
      )}
      {error && (
        <div
          className="mt-3 rounded-xl p-2 text-xs"
          style={{
            background: "var(--bunq-bad-soft)",
            color: "var(--bunq-bad)",
          }}
        >
          {error}
        </div>
      )}
      <div className="mt-6 flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 rounded-full px-4 py-2.5 text-sm font-semibold"
          style={{
            background: "var(--bunq-surface-2)",
            border: "1px solid var(--bunq-border-strong)",
            color: "var(--bunq-text)",
          }}
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={pending}
          className="bunq-glow flex-1 rounded-full px-4 py-2.5 text-sm font-bold disabled:opacity-50"
          style={{
            background: "var(--bunq-green)",
            color: "#0a0d05",
          }}
        >
          {pending
            ? "Moving money…"
            : `Confirm €${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
        </button>
      </div>
    </>
  );
}

function ReceiptView({
  receipt,
  balance,
  onAnother,
  onShowHistory,
  onClose,
}: {
  receipt: InvestReceipt;
  balance: BunqBalance | null;
  onAnother: () => void;
  onShowHistory: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-green)]">
        <BunqMark />
        receipt
      </div>
      <h2 className="mt-3 bunq-numeral text-3xl font-black">
        Transfer complete
      </h2>
      {balance && (
        <div className="mt-5 grid grid-cols-2 gap-3">
          <BalancePill label="Main Wallet" value={balance.main} />
          <BalancePill label="Investment Pot" value={balance.pot} accent />
        </div>
      )}
      <dl className="mt-6 space-y-3 text-sm">
        <Row k="Bunq payment" v={receipt.bunq_payment_id ?? "—"} />
        {receipt.bunq_pot_name && (
          <Row k="Bunq pot" v={`${receipt.bunq_pot_name} · #${receipt.bunq_pot_id ?? "—"}`} />
        )}
        <Row k="Alpaca order" v={receipt.alpaca_order_id ?? "—"} />
        <Row
          k="Amount"
          v={`€${receipt.amount_eur.toFixed(2)} → $${receipt.amount_usd.toFixed(2)}`}
        />
        <Row k="Shares" v={receipt.shares.toString()} />
        <Row k="Ticker" v={receipt.ticker} />
        <Row k="Timestamp" v={receipt.timestamp.slice(0, 19)} />
      </dl>
      <div className="mt-7 grid grid-cols-2 gap-3">
        <button
          onClick={onShowHistory}
          className="rounded-full px-5 py-3 text-sm font-semibold"
          style={{
            background: "var(--bunq-surface-2)",
            border: "1px solid var(--bunq-border-strong)",
            color: "var(--bunq-text)",
          }}
        >
          View all tickets
        </button>
        <button
          onClick={onAnother}
          className="bunq-glow rounded-full px-5 py-3 text-sm font-bold"
          style={{
            background: "var(--bunq-green)",
            color: "#0a0d05",
          }}
        >
          Invest again ↗
        </button>
      </div>
      <button
        onClick={onClose}
        className="mt-3 w-full rounded-full px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em]"
        style={{ color: "var(--bunq-muted)" }}
      >
        close
      </button>
    </>
  );
}

function HistoryView({
  history,
  loading,
  error,
  currentTicker,
  onMakeOne,
  onSelect,
}: {
  history: InvestmentRow[] | null;
  loading: boolean;
  error: string | null;
  currentTicker: string;
  onMakeOne: () => void;
  onSelect: (row: InvestmentRow) => void;
}) {
  // Sort current ticker's rows first, then by date desc.
  const sorted = useMemo(() => {
    if (!history) return null;
    return [...history].sort((a, b) => {
      const aMatch = a.ticker === currentTicker ? 1 : 0;
      const bMatch = b.ticker === currentTicker ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
      return b.created_at.localeCompare(a.created_at);
    });
  }, [history, currentTicker]);

  return (
    <>
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-green)]">
        <BunqMark />
        receipt history
      </div>
      <h2 className="mt-2 bunq-numeral text-3xl font-black">All tickets</h2>
      <p className="mt-1 text-sm text-[var(--bunq-muted)]">
        Every paper trade you've fired through Sauron. Tickets persist even
        after the modal closes — receipts also live on your dashboard.
      </p>

      {loading && (
        <div className="mt-4 font-mono text-[11px] text-[var(--bunq-faint)]">
          loading receipts…
        </div>
      )}
      {error && (
        <div
          className="mt-4 rounded-xl p-2 text-xs"
          style={{
            background: "var(--bunq-bad-soft)",
            color: "var(--bunq-bad)",
          }}
        >
          {error}
        </div>
      )}
      {sorted && sorted.length === 0 && !loading && (
        <div
          className="mt-4 rounded-2xl p-4 text-sm text-[var(--bunq-muted)]"
          style={{
            background: "var(--bunq-surface-2)",
            border: "1px solid var(--bunq-border)",
          }}
        >
          No tickets yet. Click <span style={{ color: "var(--bunq-green)" }}>Invest</span> to make your first paper trade.
        </div>
      )}
      {sorted && sorted.length > 0 && (
        <ul
          className="mt-4 max-h-[55vh] space-y-2 overflow-y-auto pr-1"
          aria-label="Investment receipts"
        >
          {sorted.map((r) => (
            <ReceiptRow
              key={r.id}
              r={r}
              isCurrent={r.ticker === currentTicker}
              onClick={() => onSelect(r)}
            />
          ))}
        </ul>
      )}

      <div className="mt-5 grid grid-cols-2 gap-2">
        <Link
          href="/dashboard"
          className="rounded-full px-4 py-2.5 text-center text-sm font-semibold"
          style={{
            background: "var(--bunq-surface-2)",
            border: "1px solid var(--bunq-border-strong)",
            color: "var(--bunq-text)",
          }}
        >
          Open dashboard ↗
        </Link>
        <button
          onClick={onMakeOne}
          className="bunq-glow rounded-full px-4 py-2.5 text-sm font-bold"
          style={{
            background: "var(--bunq-green)",
            color: "#0a0d05",
          }}
        >
          Make a new ticket
        </button>
      </div>
    </>
  );
}

function ReceiptRow({
  r,
  isCurrent,
  onClick,
}: {
  r: InvestmentRow;
  isCurrent: boolean;
  onClick: () => void;
}) {
  const status = r.alpaca?.status ?? "pending";
  const pnl = r.unrealized_pnl_usd;
  const pct = r.unrealized_pnl_pct;
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="w-full rounded-2xl p-3 text-left transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--bunq-green)]"
        aria-label={`Open ticket for ${r.ticker} on ${r.created_at.slice(0, 10)}`}
        style={{
          background: isCurrent
            ? "linear-gradient(160deg, rgba(181,255,0,0.04), var(--bunq-surface-2))"
            : "var(--bunq-surface-2)",
          border: isCurrent
            ? "1px solid rgba(181,255,0,0.22)"
            : "1px solid var(--bunq-border)",
        }}
      >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="bunq-numeral font-mono text-sm font-bold text-[var(--bunq-text)]">
            {r.ticker}
          </span>
          {isCurrent && (
            <span
              className="rounded-full px-1.5 py-0 font-mono text-[8px] uppercase tracking-[0.16em]"
              style={{
                background: "var(--bunq-green-soft)",
                color: "var(--bunq-green)",
                border: "1px solid rgba(181,255,0,0.30)",
              }}
            >
              this stock
            </span>
          )}
          <span className="font-mono text-[10px] text-[var(--bunq-faint)]">
            {r.created_at.slice(0, 16).replace("T", " ")}
          </span>
        </div>
        <span className="bunq-numeral font-mono text-sm font-bold">
          €{r.amount_eur.toFixed(2)}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2 font-mono text-[10px] text-[var(--bunq-muted)]">
        <span>
          {r.alpaca_symbol ? `${r.alpaca_symbol} · ` : ""}
          {status}
          {r.bunq_pot_name ? ` · ${r.bunq_pot_name}` : ""}
        </span>
        {pnl !== undefined && pct !== undefined ? (
          <span
            className="bunq-numeral font-bold"
            style={{
              color:
                pnl > 0
                  ? "var(--bunq-green)"
                  : pnl < 0
                    ? "var(--bunq-bad)"
                    : "var(--bunq-text)",
            }}
          >
            {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} ({pct >= 0 ? "+" : ""}
            {pct.toFixed(2)}%)
          </span>
        ) : (
          <span className="text-[var(--bunq-faint)]">awaiting fill</span>
        )}
      </div>
      </button>
    </li>
  );
}

/**
 * Detail panel for a past ticket — same field layout the user saw when
 * they placed the trade, plus live Alpaca status / fill / unrealized P&L.
 */
function TicketDetailView({
  row,
  onBack,
  onClose,
}: {
  row: InvestmentRow;
  onBack: () => void;
  onClose: () => void;
}) {
  const status = row.alpaca?.status ?? "pending";
  const filled = row.alpaca?.filled_qty;
  const fillPrice = row.alpaca?.filled_avg_price;
  const submittedAt = row.alpaca?.submitted_at;
  const filledAt = row.alpaca?.filled_at;
  const pnl = row.unrealized_pnl_usd;
  const pct = row.unrealized_pnl_pct;
  const last = row.current_price_usd;
  const pnlColor =
    pnl === undefined
      ? "var(--bunq-text)"
      : pnl > 0
        ? "var(--bunq-green)"
        : pnl < 0
          ? "var(--bunq-bad)"
          : "var(--bunq-text)";

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-green)]">
        <button
          onClick={onBack}
          className="rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] transition hover:brightness-110"
          style={{
            background: "var(--bunq-surface-2)",
            color: "var(--bunq-muted)",
            border: "1px solid var(--bunq-border)",
          }}
        >
          ← all tickets
        </button>
        <span className="flex items-center gap-2">
          <BunqMark />
          ticket detail
        </span>
      </div>
      <h2 className="mt-2 bunq-numeral text-3xl font-black">
        {row.ticker} · €{row.amount_eur.toFixed(2)}
      </h2>
      <p className="mt-1 text-sm text-[var(--bunq-muted)]">
        {row.company_name || row.ticker}
        {row.verdict ? ` · verdict at trade: ${row.verdict}` : ""}
      </p>

      {/* live P&L block — shown above the static fields when a fill exists */}
      {pnl !== undefined && pct !== undefined ? (
        <div
          className="mt-4 rounded-2xl p-4"
          style={{
            background:
              pnl >= 0
                ? "rgba(181,255,0,0.06)"
                : "rgba(255,91,107,0.06)",
            border: `1px solid ${
              pnl >= 0 ? "rgba(181,255,0,0.22)" : "rgba(255,91,107,0.22)"
            }`,
          }}
        >
          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
            unrealized p&l (paper)
          </div>
          <div
            className="bunq-numeral mt-0.5 text-3xl font-black"
            style={{ color: pnlColor }}
          >
            {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
            <span className="ml-2 text-base font-bold">
              ({pct >= 0 ? "+" : ""}
              {pct.toFixed(2)}%)
            </span>
          </div>
          {last !== undefined && fillPrice !== undefined && fillPrice !== null && (
            <div className="mt-1 font-mono text-[11px] text-[var(--bunq-muted)]">
              fill ${fillPrice.toFixed(2)} → last ${last.toFixed(2)}
            </div>
          )}
        </div>
      ) : (
        <div
          className="mt-4 rounded-2xl p-3 font-mono text-[11px] text-[var(--bunq-faint)]"
          style={{
            background: "var(--bunq-surface-2)",
            border: "1px solid var(--bunq-border)",
          }}
        >
          {status === "accepted" || status === "new" || status === "pending_new"
            ? "Order submitted, awaiting fill at next market open."
            : "Awaiting Alpaca fill data."}
        </div>
      )}

      <dl className="mt-5 space-y-2 text-sm">
        <Row k="Ticker" v={row.ticker} />
        {row.alpaca_symbol && row.alpaca_symbol !== row.ticker && (
          <Row k="Alpaca symbol" v={row.alpaca_symbol} />
        )}
        <Row
          k="Amount"
          v={`€${row.amount_eur.toFixed(2)} → $${row.amount_usd.toFixed(2)} @ ${row.fx_rate.toFixed(2)}`}
        />
        <Row k="Shares" v={(filled ?? row.shares_estimated).toString()} />
        {fillPrice !== undefined && fillPrice !== null && (
          <Row k="Fill price" v={`$${fillPrice.toFixed(2)}`} />
        )}
        <Row k="Status" v={status} />
        <Row k="Bunq payment" v={row.bunq_payment_id ?? "—"} />
        {row.bunq_pot_name && (
          <Row
            k="Bunq pot"
            v={`${row.bunq_pot_name}${row.bunq_pot_id ? ` · #${row.bunq_pot_id}` : ""}`}
          />
        )}
        <Row k="Alpaca order" v={row.alpaca_order_id ?? "—"} />
        <Row k="Submitted" v={(submittedAt || row.created_at).slice(0, 19).replace("T", " ")} />
        {filledAt && <Row k="Filled" v={filledAt.slice(0, 19).replace("T", " ")} />}
      </dl>

      <div className="mt-6 grid grid-cols-2 gap-2">
        <Link
          href={`/analyze/${encodeURIComponent(row.ticker)}`}
          onClick={onClose}
          className="rounded-full px-4 py-2.5 text-center text-sm font-semibold"
          style={{
            background: "var(--bunq-surface-2)",
            border: "1px solid var(--bunq-border-strong)",
            color: "var(--bunq-text)",
          }}
        >
          Open analysis ↗
        </Link>
        <button
          onClick={onBack}
          className="rounded-full px-4 py-2.5 text-sm font-semibold"
          style={{
            background: "var(--bunq-green-soft)",
            color: "var(--bunq-green)",
            border: "1px solid rgba(181,255,0,0.30)",
          }}
        >
          Back to history
        </button>
      </div>
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div
      className="flex justify-between gap-3 border-b pb-2"
      style={{ borderColor: "var(--bunq-border)" }}
    >
      <dt className="text-[var(--bunq-faint)]">{k}</dt>
      <dd className="bunq-numeral truncate font-mono text-[var(--bunq-text)]">
        {v}
      </dd>
    </div>
  );
}

function BalancePill({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div
      className="rounded-2xl px-4 py-3.5"
      style={{
        background: accent ? "var(--bunq-green-soft)" : "var(--bunq-surface-2)",
        border: `1px solid ${accent ? "rgba(181,255,0,0.30)" : "var(--bunq-border)"}`,
      }}
    >
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
        {label}
      </div>
      <div
        className="bunq-numeral mt-1 font-mono text-2xl font-black"
        style={{
          color: accent ? "var(--bunq-green)" : "var(--bunq-text)",
        }}
      >
        €{value.toFixed(2)}
      </div>
    </div>
  );
}

function BunqMark() {
  return (
    <span
      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-black"
      style={{ background: "var(--bunq-green)", color: "#0a0d05" }}
      aria-hidden
    >
      b
    </span>
  );
}
