"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { DataProvenance } from "@/components/DataProvenance";
import {
  scanImage,
  type ScanDetection,
  type ScanResult,
  type WalletSignal,
} from "@/lib/api";

export default function ScanPageWrapper() {
  return (
    <AuthGuard>
      <ScanPage />
    </AuthGuard>
  );
}

type Status = "idle" | "captured" | "scanning" | "done" | "error";
type Mode = "snapshot" | "ar";

// One detection still considered "current" — keyed by ticker so identical
// re-detections refresh the freshness timestamp instead of stacking up.
interface ArHit {
  detection: ScanDetection;
  lastSeen: number;
  // The box coords are scaled to the LIVE video element so we can render
  // overlays even when the video resolution differs from the snapshot
  // we sent to Claude.
  box: { x: number; y: number; w: number; h: number } | null;
}

const AR_FRAME_INTERVAL_MS = 2500;
const AR_HIT_TTL_MS = 6000; // detections fade out N ms after their last refresh

function ScanPage() {
  // The two capture paths:
  //   (a) on mobile, the <input capture="environment"> opens the OS camera
  //   (b) on desktop, we open getUserMedia + draw the selected video frame
  //       to a canvas → blob → POST /scan.
  // Both produce a Blob/File that flows through the same handleFile().

  const [mode, setMode] = useState<Mode>("snapshot");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);

  // Live-camera state (desktop)
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [liveOn, setLiveOn] = useState(false);

  // AR-mode state: ticker → detection (fading window).
  const [arHits, setArHits] = useState<Record<string, ArHit>>({});
  const arBusyRef = useRef(false); // skip new captures while one's in flight
  const arTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [arBackendBusy, setArBackendBusy] = useState(false);
  const [arError, setArError] = useState<string | null>(null);
  // Re-render every second so TTL-based fading is reactive even when no
  // new detections arrive.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (mode !== "ar" || !liveOn) return;
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [mode, liveOn]);

  useEffect(() => {
    return () => {
      // tear down stream on unmount
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startLiveCamera() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      // Flip the UI first so the <video> element mounts; the useEffect below
      // then attaches the stream to its ref. Doing it the other way around
      // races the ref (it's null until React renders the live block).
      setLiveOn(true);
    } catch (e) {
      setError(
        (e as Error).message ||
          "Camera access denied. Use 'Choose / capture' instead."
      );
    }
  }

  // Attach (or re-attach) the live stream whenever live mode flips on AND we
  // have a stream. Browsers block autoplay unless the video is muted +
  // playsInline, both of which are set on the element below.
  useEffect(() => {
    if (!liveOn) return;
    const v = videoRef.current;
    const s = streamRef.current;
    if (!v || !s) return;
    v.srcObject = s;
    v.play().catch((err) => {
      setError(`Could not start preview: ${(err as Error).message}`);
    });
  }, [liveOn]);

  function stopLiveCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const v = videoRef.current;
    if (v) {
      try {
        v.pause();
      } catch {
        // ignore — pause() can throw if already detached
      }
      v.srcObject = null;
    }
    setLiveOn(false);
    if (arTimerRef.current) {
      clearInterval(arTimerRef.current);
      arTimerRef.current = null;
    }
    arBusyRef.current = false;
    setArHits({});
    setArError(null);
  }

  // ---- AR mode: throttled continuous capture loop ----
  useEffect(() => {
    if (mode !== "ar" || !liveOn) {
      if (arTimerRef.current) {
        clearInterval(arTimerRef.current);
        arTimerRef.current = null;
      }
      return;
    }

    async function tick() {
      if (arBusyRef.current) return;
      const v = videoRef.current;
      if (!v || v.videoWidth === 0) return;
      arBusyRef.current = true;
      setArBackendBusy(true);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", 0.7),
        );
        if (!blob) return;
        const r = await scanImage(
          new File([blob], "ar.jpg", { type: "image/jpeg" }),
        );
        setArError(null);
        const now = Date.now();
        setArHits((prev) => {
          const next = { ...prev };
          for (const d of r.detections) {
            if (!d.is_listed || !d.ticker) continue;
            next[d.ticker] = {
              detection: d,
              lastSeen: now,
              box: d.box ?? prev[d.ticker]?.box ?? null,
            };
          }
          // Drop expired entries.
          for (const k of Object.keys(next)) {
            if (now - next[k].lastSeen > AR_HIT_TTL_MS) delete next[k];
          }
          return next;
        });
      } catch (e) {
        setArError((e as Error).message);
      } finally {
        arBusyRef.current = false;
        setArBackendBusy(false);
      }
    }

    void tick();
    arTimerRef.current = setInterval(() => void tick(), AR_FRAME_INTERVAL_MS);
    return () => {
      if (arTimerRef.current) {
        clearInterval(arTimerRef.current);
        arTimerRef.current = null;
      }
    };
  }, [mode, liveOn]);

  async function captureFromVideo() {
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
    stopLiveCamera();
    void handleFile(new File([blob], "snap.jpg", { type: "image/jpeg" }));
  }

  async function handleFile(file: File) {
    setError(null);
    setResult(null);
    setStatus("captured");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));

    try {
      setStatus("scanning");
      const r = await scanImage(file);
      setResult(r);
      setStatus("done");
    } catch (e) {
      setError((e as Error).message);
      setStatus("error");
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8">
      <header>
        <Link
          href="/"
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)] hover:text-[var(--bunq-text)]"
        >
          ← back
        </Link>
        <div className="mt-3 flex flex-wrap items-baseline gap-3">
          <h1 className="bunq-numeral text-4xl font-black tracking-tight">
            Scan
          </h1>
          <DataProvenance kind="object_scan" />
        </div>
        <p className="mt-1 max-w-2xl text-sm text-[var(--bunq-muted)]">
          Point your camera at a product, store, car, label, anything. Claude
          vision identifies branded items, maps them to publicly listed parent
          companies, and tells you whether they're worth a deeper look.
        </p>
      </header>

      {/* capture surface */}
      <section
        className="rounded-3xl p-5"
        style={{
          background: "var(--bunq-surface)",
          border: "1px solid var(--bunq-border)",
        }}
      >
        {liveOn ? (
          <div className="space-y-3">
            <ModeToggle mode={mode} onChange={setMode} />
            <div className="relative">
              <video
                ref={videoRef}
                playsInline
                muted
                className="aspect-video w-full rounded-2xl bg-black"
              />
              {mode === "ar" && (
                <ArOverlay
                  hits={arHits}
                  busy={arBackendBusy}
                />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {mode === "snapshot" ? (
                <button
                  onClick={captureFromVideo}
                  className="rounded-full px-5 py-2 text-sm font-bold"
                  style={{ background: "var(--bunq-green)", color: "#0a0d05" }}
                >
                  ◉ Snap
                </button>
              ) : (
                <span
                  className="flex items-center gap-2 rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]"
                  style={{
                    background: "var(--bunq-green-soft)",
                    color: "var(--bunq-green)",
                    border: "1px solid rgba(181,255,0,0.30)",
                  }}
                >
                  <span className={arBackendBusy ? "animate-spin" : ""}>
                    {arBackendBusy ? "⟳" : "●"}
                  </span>
                  <span>
                    AR · {Object.keys(arHits).length} on-frame
                  </span>
                </span>
              )}
              <button
                onClick={stopLiveCamera}
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
            {arError && mode === "ar" && (
              <div
                className="rounded-xl px-3 py-2 text-xs"
                style={{
                  background: "var(--bunq-bad-soft)",
                  color: "var(--bunq-bad)",
                }}
              >
                {arError}
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <button
              onClick={startLiveCamera}
              className="flex flex-col items-start gap-1 rounded-2xl px-5 py-6 text-left transition hover:brightness-110"
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
                Stream from your device camera; tap Snap to capture a frame.
              </span>
            </button>

            <label
              className="flex cursor-pointer flex-col items-start gap-1 rounded-2xl px-5 py-6 text-left transition hover:brightness-110"
              style={{
                background: "var(--bunq-surface-2)",
                border: "1px solid var(--bunq-border)",
              }}
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-muted)]">
                photo · video frame
              </span>
              <span className="text-base font-bold text-[var(--bunq-text)]">
                Choose / capture
              </span>
              <span className="text-xs text-[var(--bunq-muted)]">
                On phones this opens the rear camera; on desktop it picks an
                image. Videos: take a still and upload that.
              </span>
              <input
                type="file"
                accept="image/*"
                // The capture attribute is what makes mobile open the rear
                // camera directly. Desktop browsers ignore it.
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                  e.currentTarget.value = "";
                }}
              />
            </label>
          </div>
        )}
      </section>

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

      {/* preview + result */}
      {(previewUrl || status === "scanning" || result) && (
        <section className="grid gap-5 md:grid-cols-[300px_1fr]">
          <div>
            {previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="captured"
                className="w-full rounded-2xl bg-black"
              />
            )}
            <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
              {status === "scanning" && (
                <span style={{ color: "var(--bunq-green)" }}>
                  ⟳ analysing…
                </span>
              )}
              {status === "done" && result && (
                <span>
                  ✓ {result.detections.length} detection
                  {result.detections.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
            {result?.scene_summary && (
              <p className="mt-2 text-xs italic text-[var(--bunq-muted)]">
                {result.scene_summary}
              </p>
            )}
          </div>

          <div className="space-y-3">
            {status === "scanning" && (
              <div
                className="rounded-2xl p-5 text-sm text-[var(--bunq-muted)]"
                style={{
                  background: "var(--bunq-surface)",
                  border: "1px solid var(--bunq-border)",
                }}
              >
                Claude is looking for brands, logos, products, store fronts,
                vehicles, and labels in your image…
              </div>
            )}

            {result && result.detections.length === 0 && status === "done" && (
              <div
                className="rounded-2xl p-5 text-sm text-[var(--bunq-muted)]"
                style={{
                  background: "var(--bunq-surface)",
                  border: "1px solid var(--bunq-border)",
                }}
              >
                No recognisable branded items found. Try a clearer shot — get
                the logo or product name in frame.
              </div>
            )}

            {result?.detections.map((d, i) => (
              <DetectionCard key={i} d={d} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
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
      {(["snapshot", "ar"] as Mode[]).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className="rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] transition"
          style={
            mode === m
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
          {m === "snapshot" ? "Snapshot" : "Live AR"}
        </button>
      ))}
    </div>
  );
}

/** Absolute-positioned overlay for AR mode — renders one floating pill per
 *  detected branded item, anchored to its bounding box (or the centre of
 *  the frame if Claude didn't return a usable box). Detections fade out
 *  AR_HIT_TTL_MS after their last refresh so the HUD doesn't pile up
 *  stale items as the camera moves. */
function ArOverlay({
  hits,
  busy,
}: {
  hits: Record<string, ArHit>;
  busy: boolean;
}) {
  const now = Date.now();
  const items = Object.values(hits);
  return (
    <div className="pointer-events-none absolute inset-0">
      {/* Status banner top-left */}
      <div className="pointer-events-none absolute left-3 top-3">
        <span
          className="flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em]"
          style={{
            background: "rgba(0,0,0,0.55)",
            color: busy ? "var(--bunq-green)" : "var(--bunq-text)",
            border: "1px solid rgba(181,255,0,0.25)",
            backdropFilter: "blur(4px)",
          }}
        >
          <span className={busy ? "animate-spin" : ""}>
            {busy ? "⟳" : "●"}
          </span>
          ar · {items.length} {items.length === 1 ? "item" : "items"}
        </span>
      </div>

      {items.length === 0 && !busy && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span
            className="rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]"
            style={{
              background: "rgba(0,0,0,0.5)",
              color: "rgba(255,255,255,0.65)",
              backdropFilter: "blur(4px)",
            }}
          >
            point at a branded product
          </span>
        </div>
      )}

      {items.map((hit) => (
        <ArHitOverlay key={hit.detection.ticker} hit={hit} now={now} />
      ))}
    </div>
  );
}

function ArHitOverlay({ hit, now }: { hit: ArHit; now: number }) {
  const age = now - hit.lastSeen;
  const ttl = AR_HIT_TTL_MS;
  // Linear opacity fall-off in the last 1.5 seconds before TTL expiry so the
  // overlay doesn't pop out abruptly.
  const fade = Math.max(0, Math.min(1, (ttl - age) / 1500));
  const d = hit.detection;
  const box = hit.box;

  // Position: prefer the bounding box; otherwise float a centred pill.
  const positionStyle: React.CSSProperties = box
    ? {
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.w * 100}%`,
        height: `${box.h * 100}%`,
      }
    : {
        left: "10%",
        top: "10%",
        width: "80%",
        height: "80%",
      };

  // Verdict colouring is opt-in: until we wire a quick-verdict cache, every
  // detected ticker just shows the brand → parent chip + tap-to-analyse CTA.
  return (
    <Link
      href={`/analyze/${encodeURIComponent(d.ticker)}`}
      className="pointer-events-auto absolute"
      style={{
        ...positionStyle,
        opacity: fade,
        transition: "opacity 250ms linear",
      }}
      title={`Analyse ${d.company || d.ticker}`}
    >
      {/* Bounding-box outline */}
      {box && (
        <div
          className="absolute inset-0 rounded-xl"
          style={{
            border: "1.5px solid var(--bunq-green)",
            boxShadow:
              "0 0 0 1px rgba(0,0,0,0.55), 0 6px 24px -6px rgba(181,255,0,0.45)",
            background: "rgba(181,255,0,0.04)",
          }}
        />
      )}
      {/* Pill anchored to top-left of the box */}
      <div
        className="absolute -top-2 left-2 flex items-center gap-2 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em]"
        style={{
          background: "rgba(8,10,5,0.86)",
          color: "var(--bunq-green)",
          border: "1px solid rgba(181,255,0,0.45)",
          backdropFilter: "blur(6px)",
          whiteSpace: "nowrap",
        }}
      >
        <span className="bunq-numeral font-bold">{d.ticker}</span>
        <span className="opacity-80">{d.brand || d.object}</span>
        <span className="opacity-70">↗</span>
      </div>
    </Link>
  );
}

function DetectionCard({ d }: { d: ScanDetection }) {
  const confidencePct = Math.round(d.confidence * 100);
  const confColor =
    d.confidence >= 0.75
      ? "var(--bunq-green)"
      : d.confidence >= 0.5
        ? "var(--bunq-warn)"
        : "var(--bunq-muted)";

  const Wrapper: React.ElementType = d.is_listed ? Link : "div";
  const wrapperProps = d.is_listed
    ? { href: `/analyze/${encodeURIComponent(d.ticker)}` }
    : {};

  return (
    <Wrapper
      {...wrapperProps}
      className={`block rounded-2xl p-4 transition ${d.is_listed ? "hover:brightness-110" : ""}`}
      style={{
        background: d.is_listed
          ? "linear-gradient(160deg, rgba(181,255,0,0.04), var(--bunq-surface))"
          : "var(--bunq-surface)",
        border: `1px solid ${d.is_listed ? "rgba(181,255,0,0.18)" : "var(--bunq-border)"}`,
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-base font-bold text-[var(--bunq-text)]">
              {d.brand || d.object}
            </span>
            {d.is_subbrand && d.is_listed && (
              <span
                className="font-mono text-[10px] text-[var(--bunq-faint)]"
                aria-hidden
              >
                →
              </span>
            )}
            {d.is_listed && d.is_subbrand && (
              <span className="text-sm font-bold text-[var(--bunq-text)]">
                {d.company}
              </span>
            )}
            {d.is_listed && (
              <span
                className="bunq-numeral rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em]"
                style={{
                  background: "var(--bunq-green-soft)",
                  color: "var(--bunq-green)",
                }}
              >
                {d.ticker}
              </span>
            )}
            {!d.is_listed && (
              <span
                className="rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]"
                style={{
                  background: "var(--bunq-surface-2)",
                  color: "var(--bunq-muted)",
                  border: "1px solid var(--bunq-border)",
                }}
              >
                private
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--bunq-muted)]">
            {d.is_subbrand ? d.company : d.company || d.brand}
            {d.exchange ? ` · ${d.exchange}` : ""}
          </div>
          {d.parent_relationship && (
            <div className="mt-1 text-[11px] italic text-[var(--bunq-faint)]">
              {d.parent_relationship}
            </div>
          )}
        </div>
        <div className="text-right">
          <div
            className="bunq-numeral font-mono text-[11px]"
            style={{ color: confColor }}
          >
            {confidencePct}% sure
          </div>
        </div>
      </div>

      {d.investment_take && (
        <p className="mt-2 text-sm leading-snug text-[var(--bunq-text)]/90">
          {d.investment_take}
        </p>
      )}

      {d.wallet && <WalletStrip w={d.wallet} />}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-[var(--bunq-faint)]">
          {d.rationale}
        </span>
        {d.is_listed && (
          <span
            className="rounded-full px-3 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em]"
            style={{
              background: "var(--bunq-green-soft)",
              color: "var(--bunq-green)",
              border: "1px solid rgba(181,255,0,0.30)",
            }}
          >
            {d.is_subbrand
              ? `analyse parent · ${d.ticker} ↗`
              : "run full analysis ↗"}
          </span>
        )}
      </div>
    </Wrapper>
  );
}

function WalletStrip({ w }: { w: WalletSignal }) {
  const palette: Record<
    WalletSignal["relationship"],
    { bg: string; fg: string; border: string }
  > = {
    loyal: {
      bg: "rgba(181,255,0,0.10)",
      fg: "var(--bunq-green)",
      border: "rgba(181,255,0,0.35)",
    },
    regular: {
      bg: "rgba(181,255,0,0.06)",
      fg: "var(--bunq-green)",
      border: "rgba(181,255,0,0.22)",
    },
    occasional: {
      bg: "var(--bunq-surface-2)",
      fg: "var(--bunq-warn)",
      border: "rgba(255,183,77,0.22)",
    },
    none: {
      bg: "var(--bunq-surface-2)",
      fg: "var(--bunq-muted)",
      border: "var(--bunq-border)",
    },
  };
  const p = palette[w.relationship];
  const trendArrow =
    w.trend === "accelerating" ? "↗" : w.trend === "declining" ? "↘" : "→";
  const lastWhen =
    w.days_since_last === null
      ? null
      : w.days_since_last === 0
        ? "today"
        : w.days_since_last === 1
          ? "yesterday"
          : w.days_since_last < 30
            ? `${w.days_since_last}d ago`
            : w.days_since_last < 365
              ? `${Math.round(w.days_since_last / 30)}mo ago`
              : `${(w.days_since_last / 365).toFixed(1)}y ago`;

  return (
    <div
      className="mt-3 rounded-xl px-3 py-2"
      style={{
        background: p.bg,
        border: `1px solid ${p.border}`,
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <span
            className="font-mono text-[9px] uppercase tracking-[0.18em]"
            style={{ color: p.fg }}
          >
            your wallet
          </span>
          <span
            className="rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]"
            style={{
              background: "var(--bunq-surface)",
              color: p.fg,
              border: `1px solid ${p.border}`,
            }}
          >
            {w.relationship_label}
          </span>
          {w.matched && (
            <span
              className="font-mono text-[10px]"
              style={{
                color:
                  w.trend === "accelerating"
                    ? "var(--bunq-green)"
                    : w.trend === "declining"
                      ? "var(--bunq-bad)"
                      : "var(--bunq-muted)",
              }}
              title={`spend trend: ${w.trend}`}
            >
              {trendArrow} {w.trend}
            </span>
          )}
        </div>
        {w.matched && (
          <div className="text-right font-mono text-[11px]">
            <span className="bunq-numeral font-bold text-[var(--bunq-text)]">
              €{Math.round(w.total_spent_eur).toLocaleString()}
            </span>
            <span className="ml-1.5 text-[var(--bunq-muted)]">
              · {w.visit_count}{" "}
              {w.visit_count === 1 ? "visit" : "visits"}
            </span>
            {lastWhen && (
              <span className="ml-1.5 text-[var(--bunq-faint)]">
                · last {lastWhen}
              </span>
            )}
          </div>
        )}
      </div>
      {w.matched && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-[var(--bunq-faint)]">
          {w.merchant_aliases.slice(0, 3).map((a) => (
            <span
              key={a}
              className="rounded-full px-1.5 py-0.5 font-mono"
              style={{
                background: "var(--bunq-surface)",
                border: "1px solid var(--bunq-border)",
              }}
            >
              {a}
            </span>
          ))}
          {w.top_city && <span>· {w.top_city}</span>}
          <span className="ml-auto opacity-70">
            source · {w.source === "live+fixture" ? "Bunq sandbox + seed" : w.source === "live" ? "Bunq sandbox" : "seed"}
          </span>
        </div>
      )}
    </div>
  );
}
