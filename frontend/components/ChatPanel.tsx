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
  useSpeechRecognition,
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
  // Voice state
  const [ttsOn, setTtsOn] = useState(true);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const voiceInputAvail = useRef(false);
  const ttsAvail = useRef(false);

  useEffect(() => {
    voiceInputAvail.current = isVoiceInputSupported();
    ttsAvail.current = isTtsSupported();
    if (ttsAvail.current) warmVoices();
    return () => {
      // Stop any in-flight TTS when the panel unmounts (e.g. analyse page nav).
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, streamingText]);

  const sr = useSpeechRecognition({
    onFinal: (text) => {
      // Auto-send the final transcript when the user releases the mic.
      void send(text);
    },
    onInterim: (text) => {
      setInput(text);
    },
    onError: (msg) => {
      // 'no-speech' / 'aborted' / 'not-allowed' come through here. Soften
      // the user-facing copy — these are normal everyday cases.
      const friendly: Record<string, string> = {
        "not-allowed": "microphone permission denied",
        "no-speech": "didn't catch any speech, try again",
        aborted: "",
        network: "voice input is offline",
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
      if (ttsOn && ttsAvail.current) {
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
          {ttsAvail.current && (
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
              {voiceInputAvail.current && (
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
        {voiceInputAvail.current && (
          <MicButton
            active={sr.active}
            disabled={streaming}
            onStart={() => {
              setVoiceError(null);
              sr.start();
            }}
            onStop={() => sr.stop()}
          />
        )}
        <div className="flex flex-1 flex-col gap-1">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              streaming
                ? "Streaming reply…"
                : sr.active
                  ? "Listening…"
                  : "Ask anything about the analysis"
            }
            disabled={streaming || sr.active}
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
          disabled={streaming || !input.trim() || sr.active}
          className="bunq-glow rounded-full px-5 text-sm font-semibold disabled:opacity-50"
          style={{ background: "var(--bunq-green)", color: "#0a0d05" }}
        >
          Send
        </button>
      </form>
    </section>
  );
}

/** Hold-to-talk mic. Press-and-hold (or click-to-toggle on touch
 *  devices that don't reliably fire pointerup). */
function MicButton({
  active,
  disabled,
  onStart,
  onStop,
}: {
  active: boolean;
  disabled: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  // Some touch devices steal pointer events during long-press, so we also
  // accept a single click as a toggle: click to start, click again to stop.
  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (disabled) return;
    e.preventDefault();
    if (active) {
      onStop();
    } else {
      onStart();
    }
  }

  function handlePointerUp() {
    // No-op: with the pointer-down toggle pattern, release doesn't stop
    // recording (so users can lift fingers between sentences). Stop is
    // either another click or the recogniser's own end-of-speech detect.
  }

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      disabled={disabled}
      title={active ? "Tap to stop" : "Tap to talk"}
      aria-pressed={active}
      className="rounded-full px-3.5 text-base font-semibold transition disabled:opacity-50"
      style={
        active
          ? {
              background: "var(--bunq-bad-soft)",
              color: "var(--bunq-bad)",
              border: "1px solid rgba(255,91,107,0.40)",
              boxShadow:
                "0 0 0 4px rgba(255,91,107,0.15), 0 6px 18px -6px rgba(255,91,107,0.45)",
            }
          : {
              background: "var(--bunq-surface-2)",
              color: "var(--bunq-text)",
              border: "1px solid var(--bunq-border-strong)",
            }
      }
    >
      <span className={active ? "animate-pulse" : ""}>{active ? "●" : "🎤"}</span>
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
