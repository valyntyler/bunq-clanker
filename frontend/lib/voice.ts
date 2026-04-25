"use client";

/**
 * Browser-native voice helpers.
 *
 * SpeechRecognition (input)  — Chrome/Edge/Safari; live partial transcripts,
 * zero backend round-trip. We expose a hold-to-talk session so the user
 * presses the mic, dictates, and on release we auto-send the final.
 *
 * speechSynthesis (output)   — universal; we pick a clean voice (Google /
 * Apple-Siri / Microsoft Aria) when available and fall back to whatever
 * the browser ships. Streaming TTS would split the assistant reply into
 * sentence chunks so the read-back starts before generation finishes —
 * we keep it simple and speak the full reply once streaming completes.
 *
 * Both APIs are checked at runtime; if neither is available, the UI hides
 * the mic / mute buttons.
 */

import { useEffect, useRef, useState } from "react";

// The W3C SpeechRecognition spec isn't in TS's default dom lib yet, so we
// declare the minimum surface we touch. Behaves identically across the
// `webkitSpeechRecognition` (Safari/Chrome) and `SpeechRecognition`
// (Edge/standards-track) implementations.
interface SRResult {
  isFinal: boolean;
  readonly length: number;
  readonly [n: number]: { transcript: string };
}
interface SRResultList {
  readonly length: number;
  readonly [n: number]: SRResult;
}
interface SREvent extends Event {
  resultIndex: number;
  results: SRResultList;
}
interface SRInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: SREvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SRCtor = new () => SRInstance;

interface SRWindow extends Window {
  SpeechRecognition?: SRCtor;
  webkitSpeechRecognition?: SRCtor;
}

function getSR(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as SRWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isVoiceInputSupported(): boolean {
  return getSR() !== null;
}

export function isTtsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * Hold-to-talk hook. Call start() when the mic button is pressed,
 * stop() on release. interim/final transcript flow through callbacks.
 */
export function useSpeechRecognition(opts?: {
  lang?: string;
  onFinal?: (text: string) => void;
  onInterim?: (text: string) => void;
  onError?: (message: string) => void;
}) {
  const [active, setActive] = useState(false);
  const [interim, setInterim] = useState("");
  const [supported, setSupported] = useState(false);
  const recRef = useRef<SRInstance | null>(null);
  const finalAccRef = useRef("");

  useEffect(() => {
    setSupported(isVoiceInputSupported());
  }, []);

  function start() {
    const SR = getSR();
    if (!SR) {
      opts?.onError?.("voice input not supported in this browser");
      return;
    }
    if (active) return;
    finalAccRef.current = "";
    setInterim("");

    const r = new SR();
    r.lang = opts?.lang ?? "en-US";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (ev: SREvent) => {
      let interimText = "";
      let finalChunk = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        if (res.isFinal) finalChunk += res[0].transcript;
        else interimText += res[0].transcript;
      }
      if (finalChunk) {
        finalAccRef.current += finalChunk;
        opts?.onInterim?.(finalAccRef.current + interimText);
      }
      setInterim(interimText);
      opts?.onInterim?.(finalAccRef.current + interimText);
    };
    r.onerror = (ev: Event) => {
      const errCode =
        (ev as unknown as { error?: string }).error ?? "unknown";
      opts?.onError?.(errCode);
    };
    r.onend = () => {
      setActive(false);
      setInterim("");
      const finalText = finalAccRef.current.trim();
      if (finalText) opts?.onFinal?.(finalText);
    };
    recRef.current = r;
    try {
      r.start();
      setActive(true);
    } catch (e) {
      opts?.onError?.((e as Error).message);
    }
  }

  function stop() {
    recRef.current?.stop();
    // onend handles the final-text dispatch.
  }

  // Best-effort cleanup on unmount.
  useEffect(() => {
    return () => {
      try {
        recRef.current?.abort();
      } catch {
        // ignore
      }
    };
  }, []);

  return { active, interim, supported, start, stop };
}

/**
 * Pick a clean voice if the browser has one. Order of preference:
 *  - en-US Google US English
 *  - en-US Microsoft Aria / Jenny
 *  - any en-* voice with "natural" or "neural" in the name
 *  - first en-* voice
 *  - default
 */
let _cachedVoice: SpeechSynthesisVoice | null | undefined;

function pickVoice(): SpeechSynthesisVoice | null {
  if (_cachedVoice !== undefined) return _cachedVoice;
  if (!isTtsSupported()) {
    _cachedVoice = null;
    return null;
  }
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) {
    // Voices load asynchronously on some browsers — caller will retry.
    return null;
  }
  const en = voices.filter((v) => v.lang.startsWith("en"));
  const score = (v: SpeechSynthesisVoice): number => {
    const n = v.name.toLowerCase();
    let s = 0;
    if (n.includes("google")) s += 5;
    if (n.includes("aria") || n.includes("jenny")) s += 4;
    if (n.includes("natural") || n.includes("neural")) s += 3;
    if (v.lang.toLowerCase() === "en-us") s += 2;
    if (v.localService) s += 1;
    return s;
  };
  const pool = en.length > 0 ? en : voices;
  pool.sort((a, b) => score(b) - score(a));
  _cachedVoice = pool[0] ?? null;
  return _cachedVoice;
}

export function speakText(text: string, opts?: { rate?: number; pitch?: number }) {
  if (!isTtsSupported() || !text.trim()) return;
  const synth = window.speechSynthesis;
  // Cancel any in-flight utterance — the most-recent reply wins.
  try {
    synth.cancel();
  } catch {
    // ignore
  }
  const u = new SpeechSynthesisUtterance(text);
  const voice = pickVoice();
  if (voice) u.voice = voice;
  u.rate = opts?.rate ?? 1.05;
  u.pitch = opts?.pitch ?? 1.0;
  synth.speak(u);
}

export function stopSpeaking() {
  if (!isTtsSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // ignore
  }
}

/** Some browsers populate the voice list asynchronously. Pre-warm so the
 *  first speakText() call has a voice immediately. */
export function warmVoices() {
  if (!isTtsSupported()) return;
  // Trigger an initial fetch
  window.speechSynthesis.getVoices();
  // Listen for the voiceschanged event (Chrome) and re-cache.
  const onChange = () => {
    _cachedVoice = undefined; // invalidate
    pickVoice();
  };
  window.speechSynthesis.addEventListener("voiceschanged", onChange, {
    once: true,
  });
}

/** Clean up Markdown / citation noise before sending to TTS so the synth
 *  doesn't read out asterisks, brackets, code fences. */
export function cleanForSpeech(text: string): string {
  return text
    // Strip our citation chips
    .replace(/\[[a-z_]+(?::[^\]]+)?\]/gi, "")
    // Strip bold/italic markers
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    // Strip inline code
    .replace(/`([^`]+)`/g, "$1")
    // Collapse markdown links to just the text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
}
