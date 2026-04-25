"use client";

/**
 * Voice helpers — input via MediaRecorder + getUserMedia (noise-suppressed),
 * output via browser speechSynthesis.
 *
 * Why MediaRecorder over the SpeechRecognition Web API? SpeechRecognition
 * uses its own raw mic stream and ignores the noiseSuppression /
 * echoCancellation / autoGainControl flags, so a noisy room kills the
 * transcript quality. MediaRecorder lets us:
 *   1. acquire the mic via getUserMedia with explicit cleanup flags
 *   2. route the stream through Web Audio API for an extra highpass +
 *      compressor pass that knocks down low-frequency rumble + AC hum
 *   3. record the *cleaned* output into a webm/opus blob
 *   4. ship the blob to /voice/transcribe (AWS Transcribe) for the text
 *
 * Tradeoff: we lose the live partial-transcript UX (transcripts arrive
 * after the user releases the mic), but transcription quality goes way
 * up in real-world environments — which is the actual problem in a demo.
 */

import { useEffect, useRef, useState } from "react";
import { BACKEND_URL } from "./api";

const TOKEN_KEY = "sauron.token";
function authHeader(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const t = window.localStorage.getItem(TOKEN_KEY);
  return t ? { authorization: `Bearer ${t}` } : {};
}

export function isVoiceInputSupported(): boolean {
  if (typeof window === "undefined") return false;
  return !!(
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function" &&
    typeof window.MediaRecorder !== "undefined"
  );
}

export function isTtsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

// Pick a MediaRecorder mimeType that this browser actually supports. Order
// matters: Chrome/Firefox prefer webm/opus; Safari only does mp4/m4a.
function pickRecorderMime(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
    "audio/mpeg",
  ];
  for (const m of candidates) {
    if (
      typeof MediaRecorder.isTypeSupported === "function" &&
      MediaRecorder.isTypeSupported(m)
    ) {
      return m;
    }
  }
  return undefined;
}

interface RecorderHandle {
  active: boolean;
  level: number; // 0..1, RMS amplitude for the live mic level meter
  transcribing: boolean;
  error: string | null;
  start(): Promise<void>;
  stop(): void;
}

interface UseRecorderOpts {
  onFinal: (text: string) => void;
  onError?: (msg: string) => void;
  /** Hard cap on recording length — the backend caps at 60s anyway. */
  maxDurationMs?: number;
}

/**
 * Hold-to-talk hook driven by MediaRecorder. start() acquires the mic,
 * stop() ends recording and uploads the blob; on success the transcript
 * flows through `onFinal`.
 */
export function useMicRecorder(opts: UseRecorderOpts): RecorderHandle {
  const [active, setActive] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const meterRafRef = useRef<number | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function teardown() {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    if (meterRafRef.current) {
      cancelAnimationFrame(meterRafRef.current);
      meterRafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close().catch(() => undefined);
    }
    audioCtxRef.current = null;
    recRef.current = null;
    setLevel(0);
  }

  useEffect(() => () => teardown(), []);

  async function start(): Promise<void> {
    if (active || transcribing) return;
    setError(null);
    chunksRef.current = [];

    let stream: MediaStream;
    try {
      // Browser-native noise suppression flags. These are the modern
      // Chrome / Edge / Safari builtins — they're surprisingly good in
      // 2026 (echo cancellation handles speakers, noise suppression
      // handles AC + room rumble + keyboard).
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: false,
      });
    } catch (e) {
      const msg = (e as Error).message || "microphone permission denied";
      setError(msg);
      opts.onError?.(msg);
      return;
    }

    // Web Audio post-processing on top of the browser flags: a highpass
    // at 100Hz to cut low rumble that NS sometimes lets through, plus a
    // dynamics compressor to even out volume between phrases. This is
    // the 'synthesised' audio the user asked for.
    let ctx: AudioContext;
    let processedStream: MediaStream;
    let analyser: AnalyserNode;
    try {
      const Ctx: typeof AudioContext =
        (window.AudioContext as typeof AudioContext) ||
        // @ts-expect-error - webkit prefix on older Safari
        window.webkitAudioContext;
      ctx = new Ctx();
      const source = ctx.createMediaStreamSource(stream);
      const highpass = ctx.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 100; // Hz
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -32;
      compressor.knee.value = 12;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.005;
      compressor.release.value = 0.12;
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      const dest = ctx.createMediaStreamDestination();
      // Chain: source → highpass → compressor → analyser → dest
      source.connect(highpass);
      highpass.connect(compressor);
      compressor.connect(analyser);
      analyser.connect(dest);
      processedStream = dest.stream;
    } catch (e) {
      // If Web Audio isn't available (very old browser), record raw.
      console.warn("voice: Web Audio unavailable, recording raw stream:", e);
      processedStream = stream;
      ctx = new (window.AudioContext as typeof AudioContext)();
      const fallbackSource = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      fallbackSource.connect(analyser);
    }

    streamRef.current = stream;
    audioCtxRef.current = ctx;

    const mime = pickRecorderMime();
    let rec: MediaRecorder;
    try {
      rec = mime
        ? new MediaRecorder(processedStream, { mimeType: mime })
        : new MediaRecorder(processedStream);
    } catch (e) {
      const msg =
        "this browser doesn't support audio recording (try Chrome / Edge / Safari)";
      setError(msg);
      opts.onError?.(msg);
      teardown();
      return;
    }
    recRef.current = rec;

    rec.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
    };
    rec.onstop = async () => {
      const recordedMime = rec.mimeType || "audio/webm";
      // Snapshot before teardown nulls the refs.
      const blob = new Blob(chunksRef.current, { type: recordedMime });
      teardown();
      setActive(false);
      if (blob.size < 800) {
        // Effectively silence — skip the upload to spare AWS credits.
        opts.onError?.("didn't catch any speech, try again");
        return;
      }
      setTranscribing(true);
      try {
        const fd = new FormData();
        fd.set("file", blob, "voice." + (recordedMime.includes("ogg") ? "ogg" : recordedMime.includes("mp4") ? "m4a" : "webm"));
        const r = await fetch(`${BACKEND_URL}/voice/transcribe`, {
          method: "POST",
          headers: { ...authHeader() },
          body: fd,
        });
        if (!r.ok) {
          const body = await r.text();
          let detail = body;
          try {
            detail = JSON.parse(body).detail ?? body;
          } catch {
            // not JSON
          }
          throw new Error(detail || `${r.status} ${r.statusText}`);
        }
        const out = (await r.json()) as { transcript: string };
        const text = (out.transcript || "").trim();
        if (text) {
          opts.onFinal(text);
        } else {
          opts.onError?.("transcribe came back empty");
        }
      } catch (e) {
        const msg = (e as Error).message;
        setError(msg);
        opts.onError?.(msg);
      } finally {
        setTranscribing(false);
      }
    };

    // Live mic-level meter — drives the visual on the mic button so the
    // user knows we're actually capturing them.
    const buf = new Uint8Array(analyser.fftSize);
    function pumpMeter() {
      if (!recRef.current) return;
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      // Normalise to a friendlier 0..1; log-shape so quiet voice still bumps.
      const norm = Math.min(1, Math.log10(1 + rms * 30) / 1.3);
      setLevel(norm);
      meterRafRef.current = requestAnimationFrame(pumpMeter);
    }
    meterRafRef.current = requestAnimationFrame(pumpMeter);

    rec.start(250); // emit dataavailable every 250ms

    if (opts.maxDurationMs && opts.maxDurationMs > 0) {
      stopTimerRef.current = setTimeout(() => {
        try {
          rec.stop();
        } catch {
          // ignore — already stopped
        }
      }, opts.maxDurationMs);
    }

    setActive(true);
  }

  function stop() {
    if (!active) return;
    try {
      recRef.current?.stop();
    } catch {
      // already stopped
    }
  }

  return { active, level, transcribing, error, start, stop };
}

/** Pick a clean voice if the browser has one. Order of preference:
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
    return null; // populate is async on Chrome; caller will retry.
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

export function warmVoices() {
  if (!isTtsSupported()) return;
  window.speechSynthesis.getVoices();
  const onChange = () => {
    _cachedVoice = undefined;
    pickVoice();
  };
  window.speechSynthesis.addEventListener("voiceschanged", onChange, {
    once: true,
  });
}

/** Strip Markdown / citation noise so TTS reads cleanly. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/\[[a-z_]+(?::[^\]]+)?\]/gi, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
