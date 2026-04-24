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
    <section
      className="rounded-3xl border"
      style={{
        background: "var(--bunq-surface)",
        borderColor: "var(--bunq-border)",
      }}
    >
      <header
        className="flex items-center justify-between rounded-t-3xl border-b px-5 py-3"
        style={{ borderColor: "var(--bunq-border)" }}
      >
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--bunq-green)]">
          <span
            className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-black"
            style={{ background: "var(--bunq-green)", color: "#0a0d05" }}
          >
            b
          </span>
          chat with the analyst · {report.ticker}
        </div>
        {history.length > 0 && (
          <button
            onClick={() => setHistory([])}
            className="font-mono text-[10px] text-[var(--bunq-faint)] hover:text-[var(--bunq-muted)]"
          >
            reset
          </button>
        )}
      </header>

      <div className="max-h-[55vh] space-y-3 overflow-y-auto p-5">
        {history.length === 0 && !streaming && (
          <div>
            <p className="text-xs text-[var(--bunq-muted)]">
              Ask about the verdict, the panel data, or what would change the
              call. Replies are grounded in the modules above.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="rounded-full border px-3 py-1 text-[11px] hover:bg-[var(--bunq-surface-2)]"
                  style={{
                    borderColor: "var(--bunq-border-strong)",
                    background: "var(--bunq-surface-2)",
                    color: "var(--bunq-text)",
                  }}
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
        className="flex gap-2 rounded-b-3xl border-t p-3"
        style={{ borderColor: "var(--bunq-border)" }}
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
          className="flex-1 rounded-full px-4 py-2 text-sm outline-none disabled:opacity-50"
          style={{
            background: "var(--bunq-surface-2)",
            border: "1px solid var(--bunq-border-strong)",
            color: "var(--bunq-text)",
          }}
        />
        <button
          type="submit"
          disabled={streaming || !input.trim()}
          className="bunq-glow rounded-full px-5 text-sm font-semibold disabled:opacity-50"
          style={{ background: "var(--bunq-green)", color: "#0a0d05" }}
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
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm leading-relaxed"
        style={
          isUser
            ? { background: "var(--bunq-green)", color: "#0a0d05" }
            : {
                border: "1px solid var(--bunq-border)",
                background: "var(--bunq-surface-2)",
                color: "var(--bunq-text)",
              }
        }
      >
        {turn.content}
        {streaming && (
          <span
            className="ml-1 inline-block h-3 w-1.5 animate-pulse align-middle"
            style={{ background: "var(--bunq-green)" }}
          />
        )}
      </div>
    </div>
  );
}
