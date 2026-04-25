"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** A reusable drag-and-drop wrapper around an <input type="file">.
 *
 *  Two ways to use it:
 *    1. Pass `children` and we render an empty drop surface that you style
 *       however you like. We handle the click → opens file picker, drag-over
 *       highlight, drop, and forwarding the file to `onFile`.
 *    2. Pass `renderTrigger={(open) => ...}` if you want full control over
 *       the inner click target (e.g. a custom button) but still want
 *       drag-to-drop on the surrounding region.
 *
 *  We intentionally do NOT block dragover globally (the browser would
 *  otherwise navigate away if a file is dropped outside). The dropzone
 *  catches files dropped over its own region only — dropping elsewhere on
 *  the page still no-ops.
 */
export interface DropZoneProps {
  /** Comma-separated list of MIME types or extensions, mirrors <input accept>. */
  accept: string;
  /** Mobile camera capture hint. Desktop ignores it. */
  capture?: "user" | "environment" | boolean;
  /** Called whenever a single file is picked (drop or browse). */
  onFile: (file: File) => void;
  /** Disable the picker (still renders, but doesn't open or accept drops). */
  disabled?: boolean;
  /** Inline content of the drop surface. */
  children?: ReactNode;
  /** Override the visual rendering. Receives an `open` callback that opens
   *  the native file picker. */
  renderTrigger?: (open: () => void) => ReactNode;
  /** Forwarded to the wrapper element so the caller controls layout. */
  className?: string;
  style?: React.CSSProperties;
  /** Called when the user drops something we can't accept. Defaults to a
   *  short inline error inside the drop surface. */
  onReject?: (reason: string) => void;
  /** Aria-label for the implicit button/region. */
  ariaLabel?: string;
}

export function DropZone({
  accept,
  capture,
  onFile,
  disabled,
  children,
  renderTrigger,
  className,
  style,
  onReject,
  ariaLabel,
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hover, setHover] = useState(false);
  const [rejectMsg, setRejectMsg] = useState<string | null>(null);

  // Auto-clear the local rejection message after a beat.
  useEffect(() => {
    if (!rejectMsg) return;
    const t = setTimeout(() => setRejectMsg(null), 2500);
    return () => clearTimeout(t);
  }, [rejectMsg]);

  function open() {
    if (disabled) return;
    inputRef.current?.click();
  }

  function reject(reason: string) {
    if (onReject) onReject(reason);
    else setRejectMsg(reason);
  }

  function acceptsFile(f: File): boolean {
    if (!accept) return true;
    const acceptParts = accept
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (acceptParts.length === 0) return true;
    const fileType = (f.type || "").toLowerCase();
    const fileName = (f.name || "").toLowerCase();
    return acceptParts.some((part) => {
      // image/*, audio/*, video/* — wildcard MIME
      if (part.endsWith("/*")) {
        const prefix = part.slice(0, part.indexOf("/"));
        return fileType.startsWith(`${prefix}/`);
      }
      // .pdf, .jpg etc
      if (part.startsWith(".")) {
        return fileName.endsWith(part);
      }
      // exact MIME
      return fileType === part;
    });
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setHover(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length === 0) return;
    const f = files[0];
    if (!acceptsFile(f)) {
      reject(`That file type isn't accepted here (${f.type || "unknown"}).`);
      return;
    }
    onFile(f);
  }

  function handleDragOver(e: React.DragEvent) {
    if (disabled) return;
    // Only react if at least one of the dragged items is a file. Browsers
    // surface dragover for text selections too — we don't want to highlight
    // the zone for those.
    const hasFiles = Array.from(e.dataTransfer.items || []).some(
      (it) => it.kind === "file",
    );
    if (!hasFiles) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    if (!hover) setHover(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    // dragleave fires for child enters too; only clear when we leave the
    // surface boundary entirely.
    if (e.currentTarget === e.target) setHover(false);
  }

  // The browser navigates away if a file is dropped on a non-handler. We
  // suppress that page-wide just so accidental misses don't blow away the
  // user's session — this matches what e.g. Gmail and Linear do.
  useEffect(() => {
    function block(e: DragEvent) {
      if (!Array.from(e.dataTransfer?.items ?? []).some((i) => i.kind === "file"))
        return;
      e.preventDefault();
    }
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  const hoverStyle: React.CSSProperties = hover
    ? {
        borderColor: "var(--bunq-green)",
        boxShadow: "0 0 0 2px rgba(181,255,0,0.20)",
      }
    : {};

  // Convert the boolean/string capture prop into the attribute value React
  // accepts. Empty string when no capture so React drops the attribute.
  const captureAttr =
    capture === true
      ? "environment"
      : capture === false || capture === undefined
        ? undefined
        : capture;

  return (
    <div
      className={className}
      style={{
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "border-color 120ms ease, box-shadow 120ms ease",
        ...style,
        ...hoverStyle,
      }}
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={renderTrigger ? undefined : open}
      role={renderTrigger ? undefined : "button"}
      tabIndex={renderTrigger || disabled ? undefined : 0}
      aria-label={ariaLabel}
      onKeyDown={
        renderTrigger
          ? undefined
          : (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                open();
              }
            }
      }
    >
      {renderTrigger ? renderTrigger(open) : children}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        {...(captureAttr ? { capture: captureAttr } : {})}
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.currentTarget.value = "";
        }}
      />
      {rejectMsg && (
        <div
          className="mt-2 rounded-lg px-2 py-1 text-[11px]"
          style={{
            background: "var(--bunq-bad-soft)",
            color: "var(--bunq-bad)",
          }}
        >
          {rejectMsg}
        </div>
      )}
    </div>
  );
}
