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

// (isTtsSupported is declared further down with the Polly TTS section.)

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

// ---------------------------------------------------------------------
// Speech output — Amazon Polly Neural via the backend.
//
// Browser speechSynthesis sounds robotic and the OS-shipped voices vary
// wildly. Polly's neural engine ('Joanna', 'Matthew', 'Stephen', 'Joey')
// sounds genuinely human. The trade-off is a 1-2s round-trip per request,
// which is why we stream sentence-by-sentence below: as soon as the first
// sentence of the Claude reply is complete we hand it to Polly and start
// playing, while the next sentence is still being generated. Net effect
// is that audio playback begins ~1s after the first sentence finishes,
// not after the full reply.
//
// Falls back silently to browser speechSynthesis if /voice/tts errors.
// ---------------------------------------------------------------------

export interface TtsOptions {
  voice?: "Joanna" | "Matthew" | "Stephen" | "Joey" | string;
}

export function isTtsSupported(): boolean {
  // Even with backend Polly, the playback path needs <audio>. Effectively
  // every browser supports that.
  return typeof window !== "undefined" && "Audio" in window;
}

// One global player queue: mp3 blobs play sequentially, no overlap.
class TtsPlayer {
  private queue: Promise<HTMLAudioElement | null>[] = [];
  private current: HTMLAudioElement | null = null;
  private fetching: AbortController[] = [];
  private cancelled = false;

  /** Enqueue a sentence to be synthesised + spoken. Returns immediately;
   *  the actual fetch + play happens in the background. */
  enqueue(text: string, opts?: TtsOptions) {
    const cleaned = cleanForSpeech(text);
    if (!cleaned) return;
    this.cancelled = false;
    const ac = new AbortController();
    this.fetching.push(ac);
    const fetchPromise = this.fetchTts(cleaned, opts, ac.signal);
    this.queue.push(fetchPromise);
    void this.pump();
  }

  /** Cancel everything: in-flight fetches, queued audio, currently playing. */
  cancel() {
    this.cancelled = true;
    for (const ac of this.fetching) {
      try {
        ac.abort();
      } catch {
        // ignore
      }
    }
    this.fetching = [];
    this.queue = [];
    if (this.current) {
      try {
        this.current.pause();
      } catch {
        // ignore
      }
      this.current.src = "";
      this.current = null;
    }
    // Also cut any browser-fallback synthesis that might be running.
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
  }

  private async fetchTts(
    text: string,
    opts: TtsOptions | undefined,
    signal: AbortSignal,
  ): Promise<HTMLAudioElement | null> {
    try {
      const r = await fetch(`${BACKEND_URL}/voice/tts`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeader() },
        body: JSON.stringify({
          text,
          voice: opts?.voice ?? "Joanna",
        }),
        signal,
      });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const blob = await r.blob();
      if (signal.aborted) return null;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.preload = "auto";
      // Slight playbackRate bump — Joanna's default cadence is a touch slow.
      audio.playbackRate = 1.05;
      return audio;
    } catch (e) {
      if (signal.aborted) return null;
      // Fallback: browser speechSynthesis. Robotic, but it speaks.
      if (
        typeof window !== "undefined" &&
        "speechSynthesis" in window &&
        !this.cancelled
      ) {
        try {
          const u = new SpeechSynthesisUtterance(text);
          u.rate = 1.05;
          window.speechSynthesis.speak(u);
        } catch {
          // ignore
        }
      }
      return null;
    }
  }

  private async pump() {
    if (this.current) return; // already playing — pump will resume after
    while (this.queue.length > 0) {
      if (this.cancelled) return;
      const next = this.queue.shift();
      if (!next) continue;
      const audio = await next;
      if (this.cancelled) return;
      if (!audio) continue;
      this.current = audio;
      try {
        await new Promise<void>((resolve) => {
          const cleanup = () => {
            audio.removeEventListener("ended", cleanup);
            audio.removeEventListener("error", cleanup);
            resolve();
          };
          audio.addEventListener("ended", cleanup);
          audio.addEventListener("error", cleanup);
          audio.play().catch(() => cleanup());
        });
      } finally {
        this.current = null;
        // Free the blob URL we created.
        try {
          if (audio.src.startsWith("blob:")) URL.revokeObjectURL(audio.src);
        } catch {
          // ignore
        }
      }
    }
  }
}

const _player = new TtsPlayer();

/** Speak a complete chunk of text. For the chat-panel use case, prefer
 *  speakStreaming() — it picks sentence boundaries from a growing token
 *  stream so playback can start before the full reply lands. */
export function speakText(text: string, opts?: TtsOptions) {
  if (!isTtsSupported() || !text.trim()) return;
  _player.enqueue(text, opts);
}

export function stopSpeaking() {
  if (!isTtsSupported()) return;
  _player.cancel();
}

/** Stateful streaming TTS — call onToken() with each new bit of text from
 *  the chat stream; we'll synthesise + play complete sentences as they
 *  finish. Returns a `flush()` you call when streaming ends so any final
 *  trailing fragment also gets spoken.
 *
 *  Sentence boundaries: split on `.`, `!`, `?`, `\n`, with a minimum length
 *  of 30 chars so we don't fire one-word mp3s for "Yes." / "No." (Polly
 *  has a per-call latency floor; cramming many tiny calls makes it feel
 *  laggier, not faster).
 */
export function makeStreamingTts(opts?: TtsOptions) {
  let buf = "";
  let stopped = false;
  const SENTENCE_RE = /[.!?\n]+\s*/g;

  function pushBuffer(): void {
    if (stopped) return;
    let lastEnd = 0;
    let m: RegExpExecArray | null;
    SENTENCE_RE.lastIndex = 0;
    while ((m = SENTENCE_RE.exec(buf)) !== null) {
      const end = m.index + m[0].length;
      const candidate = buf.slice(lastEnd, end).trim();
      if (candidate.length >= 30) {
        _player.enqueue(candidate, opts);
        lastEnd = end;
      }
    }
    buf = buf.slice(lastEnd);
  }

  return {
    onToken(token: string) {
      if (stopped) return;
      buf += token;
      // Only attempt to drain when we hit punctuation, otherwise we re-scan
      // every token unnecessarily. (Cheap enough either way; this is
      // micro-optimisation.)
      if (/[.!?\n]/.test(token)) pushBuffer();
    },
    flush() {
      if (stopped) return;
      pushBuffer();
      const tail = buf.trim();
      if (tail.length >= 6) {
        _player.enqueue(tail, opts);
      }
      buf = "";
    },
    cancel() {
      stopped = true;
      buf = "";
      _player.cancel();
    },
  };
}

export function warmVoices() {
  // Kept for API compatibility with the speechSynthesis-era code; Polly
  // doesn't need warming. No-op.
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
