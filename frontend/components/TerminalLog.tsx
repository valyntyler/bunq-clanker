"use client";

import { useEffect, useRef } from "react";

export function TerminalLog({ lines }: { lines: string[] }) {
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  return (
    <div className="rounded-lg border border-emerald-900/50 bg-black p-4 font-mono text-[11px] text-emerald-400 shadow-inner">
      <div className="mb-2 flex items-center gap-2 text-emerald-600">
        <span className="h-2 w-2 rounded-full bg-rose-500" />
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        <span className="ml-2 uppercase tracking-wider">prospectus-pipeline</span>
      </div>
      <div className="h-64 overflow-y-auto pr-2 leading-relaxed">
        {lines.length === 0 && (
          <div className="text-emerald-700">idle — waiting for ticker…</div>
        )}
        {lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
        <div ref={bottom} />
      </div>
    </div>
  );
}
