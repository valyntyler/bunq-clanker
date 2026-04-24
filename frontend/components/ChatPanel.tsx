"use client";

import { useEffect, useRef, useState } from "react";
import { chatStream, type ChatTurn, type Report } from "@/lib/api";

const SUGGESTIONS = [
  "Why this verdict and not the opposite?",
  "What would change your mind?",
  "What's the biggest risk in this thesis?",
  "How much weight is the panel data really getting?",
];

export function ChatPanel({ report }: { report: Report }) {
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, streamingText]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || streaming) return;
    setInput("");
    const newHistory: ChatTurn[] = [
      ...history,
      { role: "user", content: message },
    ];
    setHistory(newHistory);
    setStreaming(true);
    setStreamingText("");
    let acc = "";
    try {
      await chatStream({
        ticker: report.ticker,
        report,
        history,
        message,
        onToken: (t) => {
          acc += t;
          setStreamingText(acc);
        },
      });
      setHistory([...newHistory, { role: "assistant", content: acc }]);
    } catch (e) {
      setHistory([
        ...newHistory,
        {
          role: "assistant",
          content: `(error: ${(e as Error).message})`,
        },
      ]);
    } finally {
      setStreaming(false);
      setStreamingText("");
    }
  }

  return (
    <section className="rounded-xl border border-emerald-900/40 bg-zinc-950">
      <header className="flex items-center justify-between border-b border-emerald-900/30 px-4 py-2">
        <div className="font-mono text-[10px] uppercase tracking-wider text-emerald-400">
          chat with the analyst · {report.ticker}
        </div>
        {history.length > 0 && (
          <button
            onClick={() => setHistory([])}
            className="text-[10px] font-mono text-zinc-500 hover:text-zinc-300"
          >
            reset
          </button>
        )}
      </header>

      <div className="max-h-[55vh] space-y-3 overflow-y-auto p-4">
        {history.length === 0 && !streaming && (
          <div>
            <p className="text-xs text-zinc-400">
              Ask about the verdict, the panel data, or what would change the
              call. Replies are grounded in the modules above.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="rounded-full border border-emerald-900/50 bg-emerald-950/30 px-3 py-1 text-[11px] text-emerald-200 hover:bg-emerald-900/40"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {history.map((t, i) => (
          <Bubble key={i} turn={t} />
        ))}

        {streaming && (
          <Bubble
            turn={{ role: "assistant", content: streamingText || "…" }}
            streaming
          />
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="flex gap-2 border-t border-emerald-900/30 p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            streaming
              ? "Streaming reply…"
              : "Ask anything about the analysis"
          }
          disabled={streaming}
          className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-emerald-700 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={streaming || !input.trim()}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </section>
  );
}

function Bubble({
  turn,
  streaming,
}: {
  turn: ChatTurn;
  streaming?: boolean;
}) {
  const isUser = turn.role === "user";
  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm leading-relaxed ${
          isUser
            ? "bg-emerald-700 text-white"
            : "border border-zinc-800 bg-zinc-900 text-zinc-100"
        }`}
      >
        {turn.content}
        {streaming && (
          <span className="ml-1 inline-block h-3 w-2 animate-pulse bg-emerald-400 align-middle" />
        )}
      </div>
    </div>
  );
}
