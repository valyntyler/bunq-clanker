"use client";

import { useState } from "react";
import {
  submitEvidence,
  type EvidenceTag,
  type UserSource,
} from "@/lib/api";

type Tab = "url" | "text";

const TAG_LABEL: Record<EvidenceTag, string> = {
  supporting: "supporting — agrees with my thesis",
  contradicting: "contradicting — challenges my thesis",
  neutral: "neutral — context only",
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
  const [note, setNote] = useState("");
  const [tag, setTag] = useState<EvidenceTag>("neutral");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function reset() {
    setUrl("");
    setText("");
    setNote("");
    setTag("neutral");
    setError(null);
    setPending(false);
  }

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const src = await submitEvidence({
        ticker,
        company_name: companyName,
        source_type: tab,
        url: tab === "url" ? url.trim() : undefined,
        text: tab === "text" ? text.trim() : undefined,
        user_note: note.trim(),
        user_tag: tag,
      });
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
      (tab === "text" && text.trim().length > 30));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-xl rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
        <div className="text-xs font-mono uppercase tracking-wider text-violet-400">
          add evidence · {ticker}
        </div>
        <h2 className="mt-1 text-2xl font-bold">Feed it your own source</h2>
        <p className="mt-1 text-sm text-zinc-400">
          The synthesizer treats user sources as supplementary evidence (cap 20%
          weight). Filings still win in conflicts.
        </p>

        <div className="mt-4 flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
          <TabBtn active={tab === "url"} onClick={() => setTab("url")}>
            URL
          </TabBtn>
          <TabBtn active={tab === "text"} onClick={() => setTab("text")}>
            Paste text
          </TabBtn>
        </div>

        {tab === "url" ? (
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
        ) : (
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
            {pending ? "Analyzing…" : "Add to analysis"}
          </button>
        </div>
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
      className={`flex-1 rounded-md px-3 py-1.5 text-xs font-mono uppercase tracking-wider ${
        active
          ? "bg-zinc-800 text-zinc-100"
          : "text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}
