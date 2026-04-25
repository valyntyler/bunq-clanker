"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { AuthGuard } from "@/components/AuthGuard";
import { DataProvenance } from "@/components/DataProvenance";
import {
  scanReceipt,
  sendSplitRequests,
  type ReceiptItem,
  type ReceiptResult,
  type SplitResult,
} from "@/lib/api";

export default function ReceiptsPageWrapper() {
  return (
    <AuthGuard>
      <ReceiptsPage />
    </AuthGuard>
  );
}

type Tab = "spend" | "split";
type Status = "idle" | "scanning" | "done" | "error";

const PALETTE = [
  "var(--bunq-green)",
  "#5ac8fa",
  "#ffb74d",
  "#ff5b6b",
  "#b388ff",
  "#4dd0b8",
  "#ffd54f",
  "#a1a8b4",
  "#ff8a65",
  "#7986cb",
];

function ReceiptsPage() {
  const [tab, setTab] = useState<Tab>("spend");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<ReceiptResult | null>(null);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl]
  );

  async function handleFile(file: File) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setStatus("scanning");
    setError(null);
    setResult(null);
    try {
      const r = await scanReceipt(file);
      setResult(r);
      setStatus("done");
      // Auto-flip to the Split tab when the receipt is recent — the user
      // came here because they just bought something.
      if (r.is_recent) setTab("split");
    } catch (e) {
      setError((e as Error).message);
      setStatus("error");
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
      <header>
        <Link
          href="/"
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)] hover:text-[var(--bunq-text)]"
        >
          ← back
        </Link>
        <div className="mt-3 flex flex-wrap items-baseline gap-3">
          <h1 className="bunq-numeral text-4xl font-black tracking-tight">
            Receipts
          </h1>
          <DataProvenance kind="receipt_scan" />
        </div>
        <p className="mt-1 max-w-2xl text-sm text-[var(--bunq-muted)]">
          Snap a receipt — Claude vision parses every line item and tells you
          which publicly traded companies you actually spent at. Recent
          receipts also unlock split-the-bill mode with one-click Bunq payment
          requests to each participant.
        </p>
      </header>

      <Uploader onFile={handleFile} previewUrl={previewUrl} status={status} />

      {error && (
        <div
          className="rounded-2xl px-4 py-2 text-sm"
          style={{
            background: "var(--bunq-bad-soft)",
            color: "var(--bunq-bad)",
          }}
        >
          {error}
        </div>
      )}

      {result && (
        <>
          <ReceiptHeader r={result} />
          <Tabs tab={tab} onChange={setTab} isRecent={result.is_recent} />
          {tab === "spend" && <SpendTab r={result} />}
          {tab === "split" && (
            <SplitTab r={result} />
          )}
        </>
      )}
    </main>
  );
}

// ── upload surface ───────────────────────────────────────────────

function Uploader({
  onFile,
  previewUrl,
  status,
}: {
  onFile: (f: File) => void;
  previewUrl: string | null;
  status: Status;
}) {
  // Live-camera state — see /scan for the same render-order pattern. We
  // flip liveOn → true first so the <video> mounts, then attach the stream
  // in a useEffect when the ref is real.
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [liveOn, setLiveOn] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      // tear down the stream if the page unmounts mid-capture
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!liveOn) return;
    const v = videoRef.current;
    const s = streamRef.current;
    if (!v || !s) return;
    v.srcObject = s;
    v.play().catch((err) => {
      setCamError(`Could not start preview: ${(err as Error).message}`);
    });
  }, [liveOn]);

  async function startCamera() {
    setCamError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      setLiveOn(true);
    } catch (e) {
      setCamError(
        (e as Error).message ||
          "Camera access denied. Use 'Choose / capture' instead."
      );
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const v = videoRef.current;
    if (v) {
      try {
        v.pause();
      } catch {
        // ignore
      }
      v.srcObject = null;
    }
    setLiveOn(false);
  }

  async function snap() {
    const v = videoRef.current;
    if (!v) return;
    const canvas = document.createElement("canvas");
    const w = v.videoWidth || 1280;
    const h = v.videoHeight || 720;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92)
    );
    if (!blob) return;
    stopCamera();
    onFile(new File([blob], "receipt.jpg", { type: "image/jpeg" }));
  }

  return (
    <section
      className="rounded-3xl p-5"
      style={{
        background: "var(--bunq-surface)",
        border: "1px solid var(--bunq-border)",
      }}
    >
      {liveOn ? (
        <div className="space-y-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-green)]">
            live · point at the receipt
          </div>
          <video
            ref={videoRef}
            playsInline
            muted
            className="aspect-video w-full rounded-2xl bg-black"
          />
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void snap()}
              className="rounded-full px-5 py-2 text-sm font-bold"
              style={{
                background: "var(--bunq-green)",
                color: "#0a0d05",
              }}
            >
              ◉ Snap
            </button>
            <button
              onClick={stopCamera}
              className="rounded-full px-4 py-2 text-sm"
              style={{
                background: "var(--bunq-surface-2)",
                color: "var(--bunq-muted)",
                border: "1px solid var(--bunq-border)",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-green)]">
            upload · capture
          </div>
          <div className="mt-1 text-base font-bold text-[var(--bunq-text)]">
            Upload a receipt photo
          </div>
          <div className="mt-1 text-xs text-[var(--bunq-muted)]">
            Snap with your camera or pick a file. Max 12MB.
          </div>

          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <button
              onClick={() => void startCamera()}
              disabled={status === "scanning"}
              className="flex flex-col items-start gap-1 rounded-2xl px-5 py-4 text-left transition hover:brightness-110 disabled:opacity-50"
              style={{
                background:
                  "linear-gradient(160deg, rgba(181,255,0,0.08), var(--bunq-surface-2))",
                border: "1px solid rgba(181,255,0,0.30)",
              }}
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-green)]">
                live · webcam
              </span>
              <span className="text-base font-bold text-[var(--bunq-text)]">
                Open camera
              </span>
              <span className="text-xs text-[var(--bunq-muted)]">
                Stream from your device camera; tap Snap to capture the
                receipt.
              </span>
            </button>

            <label
              className="flex cursor-pointer flex-col items-start gap-1 rounded-2xl px-5 py-4 text-left transition hover:brightness-110"
              style={{
                background: "var(--bunq-surface-2)",
                border: "1px solid var(--bunq-border)",
              }}
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-muted)]">
                photo · file
              </span>
              <span className="text-base font-bold text-[var(--bunq-text)]">
                Choose / capture
              </span>
              <span className="text-xs text-[var(--bunq-muted)]">
                On phones this opens the rear camera; on desktop it picks an
                image.
              </span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                disabled={status === "scanning"}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                  e.currentTarget.value = "";
                }}
              />
            </label>
          </div>

          {camError && (
            <div
              className="mt-3 rounded-xl px-3 py-2 text-xs"
              style={{
                background: "var(--bunq-bad-soft)",
                color: "var(--bunq-bad)",
              }}
            >
              {camError}
            </div>
          )}
        </>
      )}

      {previewUrl && !liveOn && (
        <div className="mt-4 grid gap-3 md:grid-cols-[180px_1fr] md:items-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="receipt"
            className="w-full rounded-xl bg-black"
            style={{ maxHeight: 240, objectFit: "cover" }}
          />
          <div className="text-xs text-[var(--bunq-muted)]">
            {status === "scanning" && (
              <span style={{ color: "var(--bunq-green)" }}>
                ⟳ Claude vision is reading the line items, totals, brands,
                and resolving every product to its publicly traded parent…
              </span>
            )}
            {status === "done" && "✓ parsed"}
            {status === "error" && (
              <span style={{ color: "var(--bunq-bad)" }}>
                Parsing failed — try a sharper photo or one with the total in
                frame.
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ── tabs ────────────────────────────────────────────────────────

function Tabs({
  tab,
  onChange,
  isRecent,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
  /** Recent receipts auto-flip to Split on upload; older ones can still
   *  be split manually — we just don't auto-switch. */
  isRecent: boolean;
}) {
  return (
    <div
      className="flex gap-1 rounded-full p-1"
      style={{
        background: "var(--bunq-surface-2)",
        border: "1px solid var(--bunq-border)",
        width: "fit-content",
      }}
    >
      <TabButton
        active={tab === "spend"}
        onClick={() => onChange("spend")}
        label="Spend analysis"
      />
      <TabButton
        active={tab === "split"}
        onClick={() => onChange("split")}
        label={
          isRecent ? "Split with friends" : "Split with friends · archive"
        }
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-full px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] transition disabled:opacity-40"
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

// ── receipt header ──────────────────────────────────────────────

function ReceiptHeader({ r }: { r: ReceiptResult }) {
  return (
    <section
      className="rounded-2xl p-4"
      style={{
        background: "var(--bunq-surface)",
        border: "1px solid var(--bunq-border)",
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
            merchant
          </div>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
            <span className="text-lg font-bold text-[var(--bunq-text)]">
              {r.merchant || "—"}
            </span>
            {r.merchant_ticker && (
              <Link
                href={`/analyze/${encodeURIComponent(r.merchant_ticker)}`}
                className="bunq-numeral rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em]"
                style={{
                  background: "var(--bunq-green-soft)",
                  color: "var(--bunq-green)",
                }}
                title={`Analyse ${r.merchant_company || r.merchant_ticker}`}
              >
                {r.merchant_ticker}
              </Link>
            )}
          </div>
          <div className="mt-1 font-mono text-[10px] text-[var(--bunq-muted)]">
            {r.date || "no date"} · {r.currency} ·{" "}
            {r.is_recent ? (
              <span style={{ color: "var(--bunq-green)" }}>
                recent · split available
              </span>
            ) : (
              <span style={{ color: "var(--bunq-faint)" }}>archive</span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
            total
          </div>
          <div className="bunq-numeral text-2xl font-black text-[var(--bunq-text)]">
            {fmtMoney(r.total, r.currency)}
          </div>
          {r.listed_total > 0 && (
            <div
              className="mt-0.5 font-mono text-[10px]"
              style={{ color: "var(--bunq-green)" }}
            >
              {fmtMoney(r.listed_total, r.currency)} at listed companies
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Spend Analysis tab ──────────────────────────────────────────

function SpendTab({ r }: { r: ReceiptResult }) {
  return (
    <section className="grid gap-4 md:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
          line items · {r.items.length}
        </div>
        <ul className="space-y-1.5">
          {r.items.map((it, i) => (
            <ItemRow key={i} it={it} currency={r.currency} />
          ))}
        </ul>
      </div>
      <aside className="space-y-3">
        <div
          className="rounded-2xl p-4"
          style={{
            background: "var(--bunq-surface)",
            border: "1px solid var(--bunq-border)",
          }}
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
            spend by listed parent
          </div>
          {r.by_ticker.length === 0 ? (
            <div className="mt-2 text-xs text-[var(--bunq-muted)]">
              No publicly traded brands matched on this receipt.
            </div>
          ) : (
            <>
              <div className="mt-2 h-44">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={r.by_ticker}
                      dataKey="spend"
                      nameKey="ticker"
                      innerRadius={32}
                      outerRadius={64}
                      paddingAngle={2}
                      isAnimationActive={false}
                      stroke="var(--bunq-surface)"
                    >
                      {r.by_ticker.map((_, i) => (
                        <Cell
                          key={i}
                          fill={PALETTE[i % PALETTE.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "var(--bunq-surface)",
                        border: "1px solid var(--bunq-border-strong)",
                        borderRadius: 12,
                        fontSize: 12,
                      }}
                      formatter={(value, name) => [
                        fmtMoney(Number(value), r.currency),
                        String(name),
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-1 space-y-1 text-[11px]">
                {r.by_ticker.slice(0, 8).map((b, i) => (
                  <li
                    key={b.ticker}
                    className="flex items-baseline justify-between gap-2"
                  >
                    <span className="flex items-baseline gap-1.5 truncate">
                      <span
                        className="inline-block h-2 w-2 rounded-sm"
                        style={{ background: PALETTE[i % PALETTE.length] }}
                      />
                      <Link
                        href={`/analyze/${encodeURIComponent(b.ticker)}`}
                        className="bunq-numeral font-mono font-bold text-[var(--bunq-text)] hover:underline"
                      >
                        {b.ticker}
                      </Link>
                      <span className="truncate text-[var(--bunq-muted)]">
                        {b.company}
                      </span>
                    </span>
                    <span className="bunq-numeral font-mono text-[var(--bunq-muted)]">
                      {fmtMoney(b.spend, r.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {r.notes && (
          <div
            className="rounded-2xl p-3 text-[11px] italic text-[var(--bunq-muted)]"
            style={{
              background: "var(--bunq-surface-2)",
              border: "1px solid var(--bunq-border)",
            }}
          >
            {r.notes}
          </div>
        )}
      </aside>
    </section>
  );
}

function ItemRow({
  it,
  currency,
}: {
  it: ReceiptItem;
  currency: string;
}) {
  return (
    <li
      className="rounded-xl p-2.5"
      style={{
        background: it.is_listed
          ? "linear-gradient(160deg, rgba(181,255,0,0.04), var(--bunq-surface-2))"
          : "var(--bunq-surface-2)",
        border: it.is_listed
          ? "1px solid rgba(181,255,0,0.18)"
          : "1px solid var(--bunq-border)",
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="truncate text-sm text-[var(--bunq-text)]">
              {it.name}
            </span>
            {it.qty !== 1 && (
              <span className="font-mono text-[10px] text-[var(--bunq-faint)]">
                ×{it.qty}
              </span>
            )}
            {it.brand && (
              <span
                className="rounded-full px-1.5 py-0 font-mono text-[9px] uppercase tracking-[0.16em]"
                style={{
                  background: "var(--bunq-surface)",
                  color: "var(--bunq-muted)",
                  border: "1px solid var(--bunq-border)",
                }}
              >
                {it.brand}
              </span>
            )}
            {it.is_listed && (
              <Link
                href={`/analyze/${encodeURIComponent(it.ticker)}`}
                className="bunq-numeral rounded-full px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.16em]"
                style={{
                  background: "var(--bunq-green-soft)",
                  color: "var(--bunq-green)",
                }}
                title={`Analyse ${it.company || it.ticker}`}
              >
                {it.ticker} ↗
              </Link>
            )}
          </div>
          {it.is_listed && it.company && (
            <div className="mt-0.5 text-[10px] text-[var(--bunq-faint)]">
              owned by {it.company}
            </div>
          )}
        </div>
        <span className="bunq-numeral shrink-0 font-mono text-sm font-bold text-[var(--bunq-text)]">
          {fmtMoney(it.total_price, currency)}
        </span>
      </div>
    </li>
  );
}

// ── Split tab ───────────────────────────────────────────────────

interface Participant {
  id: string;
  name: string;
  email: string;
}

function SplitTab({ r }: { r: ReceiptResult }) {
  const [participants, setParticipants] = useState<Participant[]>([
    { id: "me", name: "You (paid)", email: "" },
    { id: "p1", name: "Friend 1", email: "" },
  ]);
  // assignments[itemIndex] is a Set of participant ids that share that item
  const [assignments, setAssignments] = useState<Record<number, string[]>>(
    () => {
      const init: Record<number, string[]> = {};
      r.items.forEach((_, i) => {
        init[i] = ["me", "p1"]; // default: split everything between the two seeds
      });
      return init;
    }
  );
  const [includeTaxFee, setIncludeTaxFee] = useState(true);
  const [sending, setSending] = useState(false);
  const [splitResult, setSplitResult] = useState<SplitResult | null>(null);
  const [splitError, setSplitError] = useState<string | null>(null);

  function addParticipant() {
    if (participants.length >= 10) return;
    const id = `p${participants.length}`;
    setParticipants((prev) => [
      ...prev,
      { id, name: `Friend ${participants.length}`, email: "" },
    ]);
    setAssignments((prev) => {
      const next = { ...prev };
      // Don't auto-assign new participants to existing items — user opts in.
      return next;
    });
  }

  function removeParticipant(id: string) {
    if (id === "me") return;
    setParticipants((prev) => prev.filter((p) => p.id !== id));
    setAssignments((prev) => {
      const next: Record<number, string[]> = {};
      for (const [k, ids] of Object.entries(prev)) {
        next[Number(k)] = ids.filter((x) => x !== id);
      }
      return next;
    });
  }

  function updateParticipant(id: string, patch: Partial<Participant>) {
    setParticipants((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch } : p))
    );
  }

  function toggle(itemIdx: number, pid: string) {
    setAssignments((prev) => {
      const cur = new Set(prev[itemIdx] ?? []);
      if (cur.has(pid)) cur.delete(pid);
      else cur.add(pid);
      return { ...prev, [itemIdx]: Array.from(cur) };
    });
  }

  // Per-participant total — items split equally among assigned participants.
  const totals = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of participants) map[p.id] = 0;

    let assignedSum = 0;
    r.items.forEach((it, i) => {
      const ids = assignments[i] ?? [];
      if (ids.length === 0) return;
      const share = it.total_price / ids.length;
      for (const id of ids) {
        if (id in map) map[id] += share;
      }
      assignedSum += it.total_price;
    });

    if (includeTaxFee && assignedSum > 0) {
      const extra = r.total - assignedSum;
      if (Math.abs(extra) > 0.01) {
        // Spread tax/fees proportionally to each person's pre-tax share.
        for (const id of Object.keys(map)) {
          map[id] += (map[id] / assignedSum) * extra;
        }
      }
    }

    const rounded: Record<string, number> = {};
    for (const [k, v] of Object.entries(map)) rounded[k] = round2(v);
    return rounded;
  }, [participants, assignments, r, includeTaxFee]);

  const sumOwed = useMemo(
    () =>
      Object.entries(totals)
        .filter(([id]) => id !== "me")
        .reduce((acc, [, v]) => acc + v, 0),
    [totals]
  );

  async function send() {
    setSending(true);
    setSplitError(null);
    setSplitResult(null);
    try {
      const targets = participants
        .filter((p) => p.id !== "me")
        .filter((p) => (totals[p.id] ?? 0) > 0)
        .map((p) => ({
          name: p.name,
          email: p.email,
          amount_eur: totals[p.id],
        }));
      if (targets.length === 0)
        throw new Error("Assign items to at least one friend first.");
      const missing = targets.filter((t) => !t.email || !t.email.includes("@"));
      if (missing.length > 0)
        throw new Error(
          `Missing email for: ${missing.map((m) => m.name).join(", ")}`
        );
      const out = await sendSplitRequests({
        merchant: r.merchant || "shared bill",
        currency: r.currency,
        participants: targets,
      });
      setSplitResult(out);
    } catch (e) {
      setSplitError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="space-y-4">
      {!r.is_recent && (
        <div
          className="rounded-2xl p-3 text-xs"
          style={{
            background: "var(--bunq-surface-2)",
            border: "1px solid var(--bunq-border)",
            color: "var(--bunq-muted)",
          }}
        >
          <span className="font-mono uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
            archive split ·
          </span>{" "}
          this receipt is from {r.date || "an earlier date"}. Splits still
          fire as Bunq payment requests, but recipients may not recognise
          the charge — add a note or talk to them first.
        </div>
      )}
      <div
        className="rounded-2xl p-4"
        style={{
          background: "var(--bunq-surface)",
          border: "1px solid var(--bunq-border)",
        }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
            who participated?
          </div>
          <button
            onClick={addParticipant}
            disabled={participants.length >= 10}
            className="rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] disabled:opacity-40"
            style={{
              background: "var(--bunq-green-soft)",
              color: "var(--bunq-green)",
              border: "1px solid rgba(181,255,0,0.30)",
            }}
          >
            + add person
          </button>
        </div>
        <div className="mt-3 grid gap-2">
          {participants.map((p) => (
            <div
              key={p.id}
              className="grid grid-cols-[16px_1fr_1.5fr_auto] items-center gap-2"
            >
              <span
                className="inline-block h-3 w-3 rounded-sm"
                style={{
                  background:
                    p.id === "me"
                      ? "var(--bunq-green)"
                      : PALETTE[
                          (parseInt(p.id.replace("p", "")) || 0) %
                            PALETTE.length
                        ],
                }}
              />
              <input
                value={p.name}
                onChange={(e) =>
                  updateParticipant(p.id, { name: e.target.value })
                }
                className="rounded-full px-3 py-1.5 text-sm outline-none"
                style={{
                  background: "var(--bunq-surface-2)",
                  border: "1px solid var(--bunq-border)",
                  color: "var(--bunq-text)",
                }}
              />
              <input
                value={p.email}
                onChange={(e) =>
                  updateParticipant(p.id, { email: e.target.value })
                }
                placeholder={
                  p.id === "me" ? "(you paid — no email needed)" : "friend@email.com"
                }
                disabled={p.id === "me"}
                className="rounded-full px-3 py-1.5 font-mono text-[12px] outline-none disabled:opacity-50"
                style={{
                  background: "var(--bunq-surface-2)",
                  border: "1px solid var(--bunq-border)",
                  color: "var(--bunq-text)",
                }}
              />
              {p.id !== "me" ? (
                <button
                  onClick={() => removeParticipant(p.id)}
                  className="rounded-full px-2 py-1 font-mono text-[10px] uppercase text-[var(--bunq-muted)] hover:text-[var(--bunq-bad)]"
                >
                  remove
                </button>
              ) : (
                <span className="font-mono text-[10px] uppercase text-[var(--bunq-faint)]">
                  payer
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div
        className="rounded-2xl p-4"
        style={{
          background: "var(--bunq-surface)",
          border: "1px solid var(--bunq-border)",
        }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
            assign items · check who shares each line
          </div>
          <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--bunq-muted)]">
            <input
              type="checkbox"
              checked={includeTaxFee}
              onChange={(e) => setIncludeTaxFee(e.target.checked)}
              className="accent-[var(--bunq-green)]"
            />
            split tax / fees proportionally
          </label>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--bunq-faint)]">
                <th className="px-2 py-1 text-left">item</th>
                <th className="px-2 py-1 text-right">price</th>
                {participants.map((p) => (
                  <th key={p.id} className="px-2 py-1 text-center" title={p.name}>
                    {p.name.split(" ")[0]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.items.map((it, i) => (
                <tr
                  key={i}
                  className="border-t"
                  style={{ borderColor: "var(--bunq-border)" }}
                >
                  <td className="px-2 py-1.5">
                    <span className="text-[var(--bunq-text)]">{it.name}</span>
                    {it.ticker && (
                      <span className="ml-2 font-mono text-[9px] text-[var(--bunq-green)]">
                        {it.ticker}
                      </span>
                    )}
                  </td>
                  <td className="bunq-numeral px-2 py-1.5 text-right font-mono text-[12px] text-[var(--bunq-muted)]">
                    {fmtMoney(it.total_price, r.currency)}
                  </td>
                  {participants.map((p) => (
                    <td key={p.id} className="px-2 py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={(assignments[i] ?? []).includes(p.id)}
                        onChange={() => toggle(i, p.id)}
                        className="accent-[var(--bunq-green)]"
                        aria-label={`assign ${it.name} to ${p.name}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div
        className="rounded-2xl p-4"
        style={{
          background: "var(--bunq-surface)",
          border: "1px solid var(--bunq-border)",
        }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
            per-person totals
          </div>
          <div className="font-mono text-[10px] text-[var(--bunq-muted)]">
            owed to you · {fmtMoney(round2(sumOwed), r.currency)}
          </div>
        </div>
        <ul className="mt-3 space-y-1.5">
          {participants.map((p) => (
            <li
              key={p.id}
              className="flex items-baseline justify-between gap-2 text-sm"
            >
              <span className="text-[var(--bunq-text)]">{p.name}</span>
              <span className="bunq-numeral font-mono font-bold">
                {fmtMoney(totals[p.id] ?? 0, r.currency)}
              </span>
            </li>
          ))}
        </ul>

        {splitError && (
          <div
            className="mt-3 rounded-xl p-2 text-xs"
            style={{
              background: "var(--bunq-bad-soft)",
              color: "var(--bunq-bad)",
            }}
          >
            {splitError}
          </div>
        )}

        {splitResult ? (
          <div className="mt-4 space-y-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-green)]">
              ✓ Bunq requests sent
            </div>
            <ul className="space-y-1 text-[12px]">
              {splitResult.results.map((r2, i) => (
                <li
                  key={i}
                  className="flex items-baseline justify-between gap-2"
                >
                  <span>
                    {r2.name}{" "}
                    <span className="text-[var(--bunq-faint)]">{r2.email}</span>
                  </span>
                  {r2.error ? (
                    <span style={{ color: "var(--bunq-bad)" }}>
                      ✗ {r2.error}
                    </span>
                  ) : (
                    <span style={{ color: "var(--bunq-green)" }}>
                      request #{r2.request_id}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <button
            onClick={() => void send()}
            disabled={sending || sumOwed <= 0}
            className="bunq-glow mt-4 w-full rounded-full px-4 py-2.5 text-sm font-bold disabled:opacity-50"
            style={{
              background: "var(--bunq-green)",
              color: "#0a0d05",
            }}
          >
            {sending
              ? "Sending Bunq requests…"
              : `Send Bunq payment requests · ${fmtMoney(round2(sumOwed), r.currency)}`}
          </button>
        )}
      </div>
    </section>
  );
}

// ── helpers ─────────────────────────────────────────────────────

function fmtMoney(n: number, ccy: string): string {
  const sym = ccy === "USD" ? "$" : ccy === "GBP" ? "£" : "€";
  return `${sym}${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
