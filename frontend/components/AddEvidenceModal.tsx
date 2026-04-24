"use client";

import { useState } from "react";
import {
  submitEvidence,
  uploadEvidence,
  type EvidenceTag,
  type UploadKind,
  type UserSource,
} from "@/lib/api";

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

  if (!open) return null;

  function reset() {
    setUrl("");
    setText("");
    setFile(null);
    setNote("");
    setTag("neutral");
    setError(null);
    setPending(false);
  }

  async function submit() {
    setPending(true);
    setError(null);
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
        src = await uploadEvidence({
          ticker,
          companyName,
          sourceType: tab as UploadKind,
          file,
          userNote: note.trim(),
          userTag: tag,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
        <div className="text-xs font-mono uppercase tracking-wider text-violet-400">
          add evidence · {ticker}
        </div>
        <h2 className="mt-1 text-2xl font-bold">Feed it your own source</h2>
        <p className="mt-1 text-sm text-zinc-400">
          User sources are capped at 20% weight in the synthesizer; filings still
          win in conflicts.
        </p>

        <div className="mt-4 grid grid-cols-3 gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1 sm:grid-cols-6">
          {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
            <TabBtn key={t} active={tab === t} onClick={() => setTab(t)}>
              {TAB_LABEL[t]}
            </TabBtn>
          ))}
        </div>

        {tab === "url" && (
          <div className="mt-3">
            <label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              URL
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono outline-none focus:border-zinc-500"
              autoFocus
            />
            <div className="mt-1 text-[10px] text-zinc-500">
              We fetch the page server-side and extract the article text.
            </div>
          </div>
        )}

        {tab === "text" && (
          <div className="mt-3">
            <label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              Pasted text (paywalled article, your notes, …)
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              placeholder="Paste a paragraph or three. ≥30 characters."
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-500"
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
          <label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            Your note (optional)
          </label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why are you adding this?"
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-zinc-500"
          />
        </div>

        <div className="mt-3">
          <label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            Your stance on this source
          </label>
          <select
            value={tag}
            onChange={(e) => setTag(e.target.value as EvidenceTag)}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-zinc-500"
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

        {error && (
          <div className="mt-3 rounded-md bg-rose-950/50 p-2 text-xs text-rose-300">
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
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm hover:bg-zinc-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="flex-1 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {pending ? "Analyzing…" : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
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
      className={`rounded-md px-2 py-1.5 text-[11px] font-mono uppercase tracking-wider ${
        active
          ? "bg-zinc-800 text-zinc-100"
          : "text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}
