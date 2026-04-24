"use client";

import { useEffect, useRef } from "react";

export function TerminalLog({ lines }: { lines: string[] }) {
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  return (
    <div
      className="rounded-2xl p-4 font-mono text-[11px] shadow-inner"
      style={{
        background: "#000",
        border: "1px solid var(--bunq-border)",
        color: "var(--bunq-green)",
      }}
    >
      <div className="mb-2 flex items-center gap-2 text-[var(--bunq-faint)]">
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: "var(--bunq-bad)" }}
        />
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: "var(--bunq-warn)" }}
        />
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: "var(--bunq-green)" }}
        />
        <span className="ml-2 uppercase tracking-[0.18em]">
          sauron · pipeline
        </span>
      </div>
      <div className="h-64 overflow-y-auto pr-2 leading-relaxed">
        {lines.length === 0 && (
          <div style={{ color: "var(--bunq-faint)" }}>
            idle — waiting for ticker…
          </div>
        )}
        {lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
        <div ref={bottom} />
      </div>
    </div>
  );
}
