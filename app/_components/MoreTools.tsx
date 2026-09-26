"use client";

import { useState } from "react";

/**
 * Secondary tools, collapsed on every page load. Closed means unmounted, so
 * nothing inside polls or reads.
 */
export function MoreTools({ summary, children }: { summary: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="flex flex-col gap-6">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-baseline gap-2 self-start rounded-md px-1 text-left hover:text-sky-700 dark:hover:text-sky-400"
      >
        <span className="w-4 text-xs text-zinc-500">{open ? "▾" : "▸"}</span>
        <span className="text-base font-semibold">More tools</span>
        <span className="text-sm text-zinc-500">{summary}</span>
      </button>
      {open && children}
    </section>
  );
}
