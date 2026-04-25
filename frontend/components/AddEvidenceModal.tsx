"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import {
  submitEvidence,
  uploadEvidenceStream,
  type EvidenceTag,
  type UploadKind,
  type UploadStepEvent,
  type UserSource,
} from "@/lib/api";

const STEP_LABEL: Record<UploadStepEvent["step"], string> = {
  compress: "Compressing with ffmpeg",
  upload: "Uploading to S3",
  audio_extract: "Extracting audio (ffmpeg)",
  frame_grid: "Sampling 9 frames into a grid",
  prosody: "Computing prosody (librosa)",
  transcribe: "Transcribing audio (AWS Transcribe)",
  pdf_extract: "Extracting text (PyMuPDF)",
  text_analyze: "Analyzing text",
  vision_claude: "Multimodal Claude analysis",
};

const STEP_ORDER_BY_TAB: Record<UploadKind, UploadStepEvent["step"][]> = {
  image: ["compress", "upload", "vision_claude"],
  video: [
    "compress",
    "upload",
    "audio_extract",
    "prosody",
    "frame_grid",
    "transcribe",
    "vision_claude",
  ],
  audio: [
    "compress",
    "upload",
    "audio_extract",
    "prosody",
    "transcribe",
    "vision_claude",
  ],
  pdf: ["upload", "pdf_extract", "text_analyze"],
};

type Tab = "url" | "text" | "image" | "video" | "audio" | "pdf";

const TAG_LABEL: Record<EvidenceTag, string> = {
  supporting: "supporting — agrees with my thesis",
  contradicting: "contradicting — challenges my thesis",
  neutral: "neutral — context only",
};

const ACCEPT: Record<Exclude<Tab, "url" | "text">, string> = {
  image: "image/png,image/jpeg,image/webp,image/gif",
  video: "video/mp4,video/quicktime,video/webm",
  audio: "audio/m4a,audio/mp3,audio/mpeg,audio/wav,audio/webm,audio/aac",
  pdf: "application/pdf",
};

const MAX_MB: Record<Exclude<Tab, "url" | "text">, number> = {
  image: 10,
  video: 60,
  audio: 30,
  pdf: 15,
};

const TAB_LABEL: Record<Tab, string> = {
  url: "URL",
  text: "Text",
  image: "Image",
  video: "Video",
  audio: "Audio",
  pdf: "PDF",
};

export function AddEvidenceModal({
  ticker,
  companyName,
  open,
  onClose,
  onAdded,
}: {
  ticker: string;
  companyName?: string;
  open: boolean;
  onClose: () => void;
  onAdded: (src: UserSource) => void;
}) {
  const [tab, setTab] = useState<Tab>("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [tag, setTag] = useState<EvidenceTag>("neutral");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepStatus, setStepStatus] = useState<
    Record<string, { status: UploadStepEvent["status"]; detail?: Record<string, unknown> }>
  >({});

  function reset() {
    setUrl("");
    setText("");
    setFile(null);
    setNote("");
    setTag("neutral");
    setError(null);
    setPending(false);
    setStepStatus({});
  }

  async function submit() {
    setPending(true);
    setError(null);
    setStepStatus({});
    try {
      let src: UserSource;
      if (tab === "url") {
        src = await submitEvidence({
          ticker,
          company_name: companyName,
          source_type: "url",
          url: url.trim(),
          user_note: note.trim(),
          user_tag: tag,
        });
      } else if (tab === "text") {
        src = await submitEvidence({
          ticker,
          company_name: companyName,
          source_type: "text",
          text: text.trim(),
          user_note: note.trim(),
          user_tag: tag,
        });
      } else {
        if (!file) throw new Error("pick a file first");
        const max = MAX_MB[tab] * 1024 * 1024;
        if (file.size > max)
          throw new Error(
            `${file.name} is ${(file.size / (1024 * 1024)).toFixed(1)}MB — max ${MAX_MB[tab]}MB`
          );
        src = await uploadEvidenceStream({
          ticker,
          companyName,
          sourceType: tab as UploadKind,
          file,
          userNote: note.trim(),
          userTag: tag,
          onStep: (ev) =>
            setStepStatus((prev) => ({
              ...prev,
              [ev.step]: { status: ev.status, detail: ev.detail },
            })),
        });
      }
      onAdded(src);
      reset();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  const canSubmit =
    !pending &&
    ((tab === "url" && url.trim().startsWith("http")) ||
      (tab === "text" && text.trim().length >= 30) ||
      (["image", "video", "audio", "pdf"].includes(tab) && file));

  const submitLabel =
    tab === "video" || tab === "audio"
      ? "Transcribe + analyze"
      : tab === "image"
        ? "Vision-analyze"
        : "Add to analysis";

  return (
    <Modal open={open} onClose={onClose} size="lg" ariaLabel="Add evidence">
      <>
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-green)]">
          <span
            className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-black"
            style={{ background: "var(--bunq-green)", color: "#0a0d05" }}
          >
            b
          </span>
          add evidence · {ticker}
        </div>
        <h2 className="mt-2 bunq-numeral text-2xl font-black">
          Feed it your own source
        </h2>
        <p className="mt-1 text-sm text-[var(--bunq-muted)]">
          User sources are capped at 20% weight in the synthesizer; filings
          still win in conflicts.
        </p>

        <div
          className="mt-4 grid grid-cols-3 gap-1 rounded-2xl p-1 sm:grid-cols-6"
          style={{
            background: "var(--bunq-surface-2)",
            border: "1px solid var(--bunq-border)",
          }}
        >
          {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
            <TabBtn key={t} active={tab === t} onClick={() => setTab(t)}>
              {TAB_LABEL[t]}
            </TabBtn>
          ))}
        </div>

        {tab === "url" && (
          <div className="mt-3">
            <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
              URL
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              className="mt-1 w-full rounded-2xl px-3 py-2 font-mono outline-none"
              style={{
                background: "var(--bunq-surface-2)",
                border: "1px solid var(--bunq-border-strong)",
                color: "var(--bunq-text)",
              }}
              autoFocus
            />
            <div className="mt-1 text-[10px] text-[var(--bunq-faint)]">
              We fetch the page server-side and extract the article text.
            </div>
          </div>
        )}

        {tab === "text" && (
          <div className="mt-3">
            <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
              Pasted text (paywalled article, your notes, …)
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              placeholder="Paste a paragraph or three. ≥30 characters."
              className="mt-1 w-full rounded-2xl px-3 py-2 font-mono text-sm outline-none"
              style={{
                background: "var(--bunq-surface-2)",
                border: "1px solid var(--bunq-border-strong)",
                color: "var(--bunq-text)",
              }}
              autoFocus
            />
          </div>
        )}

        {(tab === "image" || tab === "video" || tab === "audio" || tab === "pdf") && (
          <FileTab
            kind={tab}
            file={file}
            onFile={setFile}
            accept={ACCEPT[tab]}
            maxMb={MAX_MB[tab]}
          />
        )}

        <div className="mt-3">
          <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
            Your note (optional)
          </label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why are you adding this?"
            className="mt-1 w-full rounded-2xl px-3 py-2 text-sm outline-none"
            style={{
              background: "var(--bunq-surface-2)",
              border: "1px solid var(--bunq-border-strong)",
              color: "var(--bunq-text)",
            }}
          />
        </div>

        <div className="mt-3">
          <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
            Your stance on this source
          </label>
          <select
            value={tag}
            onChange={(e) => setTag(e.target.value as EvidenceTag)}
            className="mt-1 w-full rounded-2xl px-3 py-2 text-sm outline-none"
            style={{
              background: "var(--bunq-surface-2)",
              border: "1px solid var(--bunq-border-strong)",
              color: "var(--bunq-text)",
            }}
          >
            {(["supporting", "contradicting", "neutral"] as EvidenceTag[]).map(
              (t) => (
                <option key={t} value={t}>
                  {TAG_LABEL[t]}
                </option>
              )
            )}
          </select>
        </div>

        {pending && (tab === "image" || tab === "video" || tab === "audio" || tab === "pdf") && (
          <div
            className="mt-4 rounded-2xl p-3"
            style={{
              background: "var(--bunq-surface-2)",
              border: "1px solid var(--bunq-border)",
            }}
          >
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--bunq-faint)]">
              Pipeline
            </div>
            <ul className="mt-2 space-y-1.5">
              {STEP_ORDER_BY_TAB[tab].map((step) => {
                const s = stepStatus[step];
                const status = s?.status;
                const glyph =
                  status === "running"
                    ? "⟳"
                    : status === "done"
                      ? "✓"
                      : status === "skipped"
                        ? "·"
                        : status === "error"
                          ? "✗"
                          : "○";
                const color =
                  status === "running"
                    ? "var(--bunq-green)"
                    : status === "done"
                      ? "var(--bunq-green)"
                      : status === "error"
                        ? "var(--bunq-bad)"
                        : status === "skipped"
                          ? "var(--bunq-faint)"
                          : "var(--bunq-faint)";
                return (
                  <li key={step} className="flex items-center gap-2 text-xs">
                    <span
                      className={`bunq-numeral inline-flex h-4 w-4 items-center justify-center font-mono ${
                        status === "running" ? "animate-spin" : ""
                      }`}
                      style={{ color }}
                    >
                      {glyph}
                    </span>
                    <span
                      className="flex-1"
                      style={{
                        color:
                          status === "done" || status === "running"
                            ? "var(--bunq-text)"
                            : "var(--bunq-muted)",
                      }}
                    >
                      {STEP_LABEL[step]}
                    </span>
                    {s?.detail && status === "done" && (
                      <span className="bunq-numeral font-mono text-[10px] text-[var(--bunq-faint)]">
                        {detailLabel(step, s.detail)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
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
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={pending}
            className="flex-1 rounded-full px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
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
            disabled={!canSubmit}
            className="bunq-glow flex-1 rounded-full px-4 py-2.5 text-sm font-bold disabled:opacity-50"
            style={{ background: "var(--bunq-green)", color: "#0a0d05" }}
          >
            {pending ? "Analyzing…" : submitLabel}
          </button>
        </div>
      </>
    </Modal>
  );
}

function detailLabel(
  step: UploadStepEvent["step"],
  d: Record<string, unknown>
): string {
  if (step === "compress") {
    const inB = d.in_bytes as number | undefined;
    const outB = d.out_bytes as number | undefined;
    if (inB && outB) {
      return `${(inB / 1024).toFixed(0)}KB → ${(outB / 1024).toFixed(0)}KB`;
    }
  }
  if (step === "upload" && typeof d.bytes === "number") {
    return `${(d.bytes / 1024).toFixed(0)}KB`;
  }
  if (step === "transcribe" && typeof d.chars === "number") {
    return `${d.chars} chars`;
  }
  if (step === "prosody" && typeof d.pitch_mean_hz === "number") {
    return `${(d.pitch_mean_hz as number).toFixed(0)} Hz`;
  }
  if (step === "frame_grid" && typeof d.bytes === "number") {
    return `${(d.bytes / 1024).toFixed(0)}KB`;
  }
  if (step === "pdf_extract" && typeof d.chars === "number") {
    return `${d.chars} chars`;
  }
  return "";
}

function FileTab({
  kind,
  file,
  onFile,
  accept,
  maxMb,
}: {
  kind: "image" | "video" | "audio" | "pdf";
  file: File | null;
  onFile: (f: File | null) => void;
  accept: string;
  maxMb: number;
}) {
  const hint: Record<typeof kind, string> = {
    image: "PNG / JPEG / WebP. Claude vision reads it and scores observable facts.",
    video: "MP4 / MOV / WebM. ffmpeg extracts audio + a 9-frame grid; AWS Transcribe runs on the audio; Claude reads transcript + frames + prosody numbers as one multimodal prompt.",
    audio: "M4A / MP3 / WAV. AWS Transcribe + librosa prosody → Claude tone interpretation.",
    pdf: "Up to 30 pages. PyMuPDF extracts text; Claude scores it as supplementary evidence.",
  };
  return (
    <div className="mt-3">
      <label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
        {kind} · max {maxMb}MB
      </label>
      <input
        type="file"
        accept={accept}
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        className="mt-1 block w-full text-xs file:mr-3 file:rounded-md file:border-0 file:bg-violet-700 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-violet-600"
      />
      {file && (
        <div className="mt-1 truncate text-[11px] text-zinc-400">
          {file.name} · {(file.size / (1024 * 1024)).toFixed(2)} MB
        </div>
      )}
      <div className="mt-2 text-[10px] leading-snug text-zinc-500">
        {hint[kind]}
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl px-2 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em]"
      style={
        active
          ? { background: "var(--bunq-surface)", color: "var(--bunq-text)" }
          : { background: "transparent", color: "var(--bunq-faint)" }
      }
    >
      {children}
    </button>
  );
}
