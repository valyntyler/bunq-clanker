"use client";

import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { chatStream, type ChatTurn, type Report } from "@/lib/api";
import {
  cleanForSpeech,
  isTtsSupported,
  isVoiceInputSupported,
  speakText,
  stopSpeaking,
  useMicRecorder,
  warmVoices,
} from "@/lib/voice";

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
  // Voice state — these need to be state, not refs: the support check
  // runs after first render (only on the client, since the underlying
  // APIs touch `window`), and refs don't trigger re-renders, so any
  // refs-based gate would leave the mic button permanently invisible.
  const [ttsOn, setTtsOn] = useState(true);
  const [voiceInputAvail, setVoiceInputAvail] = useState(false);
  const [ttsAvail, setTtsAvail] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  useEffect(() => {
    const vi = isVoiceInputSupported();
    const tt = isTtsSupported();
    setVoiceInputAvail(vi);
    setTtsAvail(tt);
    if (tt) warmVoices();
    return () => {
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, streamingText]);

  const mic = useMicRecorder({
    maxDurationMs: 50_000, // backend caps at 60s; finish a tick early
    onFinal: (text) => {
      void send(text);
    },
    onError: (msg) => {
      const friendly: Record<string, string> = {
        "Permission denied": "microphone permission denied",
        "didn't catch any speech, try again": "didn't catch any speech, try again",
      };
      const m = friendly[msg] ?? msg;
      if (m) setVoiceError(m);
    },
  });

  // Clear soft errors after a few seconds.
  useEffect(() => {
    if (!voiceError) return;
    const t = setTimeout(() => setVoiceError(null), 4000);
    return () => clearTimeout(t);
  }, [voiceError]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || streaming) return;
    setInput("");
    // Cancel any in-flight TTS so the prior answer stops mid-sentence
    // when the user starts a new turn.
    stopSpeaking();
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
      if (ttsOn && ttsAvail) {
        // Speak the cleaned full reply once streaming has finished, so
        // we don't stutter on token boundaries.
        speakText(cleanForSpeech(acc));
      }
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
        <div className="flex items-center gap-2">
          {ttsAvail && (
            <button
              onClick={() => {
                setTtsOn((v) => {
                  if (v) stopSpeaking();
                  return !v;
                });
              }}
              className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em]"
              style={
                ttsOn
                  ? {
                      background: "var(--bunq-green-soft)",
                      color: "var(--bunq-green)",
                      border: "1px solid rgba(181,255,0,0.30)",
                    }
                  : {
                      background: "var(--bunq-surface-2)",
                      color: "var(--bunq-faint)",
                      border: "1px solid var(--bunq-border)",
                    }
              }
              title={ttsOn ? "Spoken replies on" : "Spoken replies off"}
            >
              {ttsOn ? "🔊 voice" : "🔇 voice"}
            </button>
          )}
          {history.length > 0 && (
            <button
              onClick={() => {
                setHistory([]);
                stopSpeaking();
              }}
              className="font-mono text-[10px] text-[var(--bunq-faint)] hover:text-[var(--bunq-muted)]"
            >
              reset
            </button>
          )}
        </div>
      </header>

      <div className="max-h-[55vh] space-y-3 overflow-y-auto p-5">
        {history.length === 0 && !streaming && (
          <div>
            <p className="text-xs text-[var(--bunq-muted)]">
              Ask about the verdict, the panel data, or what would change the
              call. Replies are grounded in the modules above.
              {voiceInputAvail && (
                <>
                  {" "}
                  <span style={{ color: "var(--bunq-green)" }}>
                    Hold the mic to talk.
                  </span>
                </>
              )}
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
        {voiceInputAvail && (
          <MicButton
            active={mic.active}
            level={mic.level}
            transcribing={mic.transcribing}
            disabled={streaming}
            onStart={() => {
              setVoiceError(null);
              void mic.start();
            }}
            onStop={() => mic.stop()}
          />
        )}
        <div className="flex flex-1 flex-col gap-1">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              streaming
                ? "Streaming reply…"
                : mic.transcribing
                  ? "Transcribing — Claude can hear you over background noise…"
                  : mic.active
                    ? "Listening — tap the mic again when you're done"
                    : "Ask anything about the analysis"
            }
            disabled={streaming || mic.active || mic.transcribing}
            className="rounded-full px-4 py-2 text-sm outline-none disabled:opacity-50"
            style={{
              background: "var(--bunq-surface-2)",
              border: "1px solid var(--bunq-border-strong)",
              color: "var(--bunq-text)",
            }}
          />
          {voiceError && (
            <span className="px-2 font-mono text-[10px] text-[var(--bunq-warn)]">
              {voiceError}
            </span>
          )}
        </div>
        <button
          type="submit"
          disabled={streaming || !input.trim() || mic.active || mic.transcribing}
          className="bunq-glow rounded-full px-5 text-sm font-semibold disabled:opacity-50"
          style={{ background: "var(--bunq-green)", color: "#0a0d05" }}
        >
          Send
        </button>
      </form>
    </section>
  );
}

/** Mic button with three states: idle (🎤), recording (live level ring),
 *  and transcribing (spinner). Tap-to-toggle so users can pause between
 *  sentences without losing the session. */
function MicButton({
  active,
  level,
  transcribing,
  disabled,
  onStart,
  onStop,
}: {
  active: boolean;
  level: number;
  transcribing: boolean;
  disabled: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (disabled || transcribing) return;
    e.preventDefault();
    if (active) {
      onStop();
    } else {
      onStart();
    }
  }
  // Bigger glow when the user is louder so it visibly responds to voice.
  const glow = active
    ? `0 0 0 ${4 + level * 18}px rgba(255,91,107,${0.10 + level * 0.18}), 0 6px 18px -6px rgba(255,91,107,0.45)`
    : undefined;

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      disabled={disabled || transcribing}
      title={
        transcribing
          ? "Transcribing your audio…"
          : active
            ? "Tap to stop"
            : "Tap to talk"
      }
      aria-pressed={active}
      className="rounded-full px-3.5 text-base font-semibold transition disabled:opacity-50"
      style={
        transcribing
          ? {
              background: "var(--bunq-green-soft)",
              color: "var(--bunq-green)",
              border: "1px solid rgba(181,255,0,0.30)",
            }
          : active
            ? {
                background: "var(--bunq-bad-soft)",
                color: "var(--bunq-bad)",
                border: "1px solid rgba(255,91,107,0.40)",
                boxShadow: glow,
              }
            : {
                background: "var(--bunq-surface-2)",
                color: "var(--bunq-text)",
                border: "1px solid var(--bunq-border-strong)",
              }
      }
    >
      <span className={transcribing ? "animate-spin" : active ? "animate-pulse" : ""}>
        {transcribing ? "⟳" : active ? "●" : "🎤"}
      </span>
    </button>
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
        className="max-w-[85%] rounded-2xl px-4 py-2 text-sm leading-relaxed"
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
        <Markdown text={turn.content} />
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
