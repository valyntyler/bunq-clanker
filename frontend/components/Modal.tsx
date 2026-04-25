"use client";

import { useEffect, useRef } from "react";

/**
 * Bunq-styled modal shell used by every dialog in the app.
 *
 * Click-away semantics:
 *   - Escape key closes
 *   - Backdrop click closes (clicking inside the panel does not)
 *   - Always-visible ✕ button top-right
 *   - Body scroll locked while open
 *   - Initial focus moved into the panel (escape from screen-reader land)
 */
export function Modal({
  open,
  onClose,
  children,
  size = "md",
  ariaLabel,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** md ≈ 28rem, lg ≈ 36rem, xl ≈ 56rem, full ≈ 96vw */
  size?: "md" | "lg" | "xl" | "full";
  ariaLabel?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Move focus into the panel so the user can tab around / Escape works.
    panelRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const maxW = {
    md: "max-w-md",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
    full: "max-w-[96vw]",
  }[size];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(e) => e.stopPropagation()}
        className={`relative max-h-[92vh] w-full overflow-y-auto rounded-3xl border shadow-2xl outline-none ${maxW}`}
        style={{
          background: "var(--bunq-surface)",
          borderColor: "var(--bunq-border)",
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="sticky right-3 top-3 z-10 ml-auto block rounded-full px-2 py-0.5 font-mono text-base leading-none transition hover:opacity-80"
          style={{
            background: "var(--bunq-surface-2)",
            color: "var(--bunq-muted)",
            border: "1px solid var(--bunq-border-strong)",
          }}
        >
          ×
        </button>
        <div className="-mt-8 px-6 pb-6 pt-2">{children}</div>
      </div>
    </div>
  );
}
