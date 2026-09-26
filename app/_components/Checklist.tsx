"use client";

import { useState } from "react";

/** A numbered checklist whose ticks come from chain state. */
export function Checklist({ children }: { children: React.ReactNode }) {
  return <ol className="flex flex-col gap-3 text-sm">{children}</ol>;
}

export function Check({
  n,
  done,
  active = true,
  title,
  children,
}: {
  n: number;
  done: boolean;
  /** False dims a step whose prerequisites aren't met yet. */
  active?: boolean;
  title: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <li className={`flex gap-3 ${!done && !active ? "opacity-50" : ""}`}>
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          done ? "bg-emerald-600 text-white" : "border border-zinc-300 text-zinc-500 dark:border-zinc-700"
        }`}
      >
        {done ? "✓" : n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className={done ? "text-zinc-500" : "font-medium"}>{title}</span>
        {children}
      </div>
    </li>
  );
}

/** Small grey explanation of why an action isn't available. */
export function Why({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-zinc-500">{children}</p>;
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

/** A copyable block of text (commands, records, env lines). */
export function CodeBlock({ text, label }: { text: string; label?: string }) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
          <span>{label}</span>
          <CopyButton text={text} />
        </div>
      )}
      <div className="relative">
        <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-zinc-950 p-3 pr-16 font-mono text-xs text-zinc-100">{text}</pre>
        {!label && (
          <span className="absolute right-2 top-2">
            <CopyButton text={text} />
          </span>
        )}
      </div>
    </div>
  );
}

/** Two small tab-like buttons for switching between forms. */
export function Tabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T | null;
  options: { id: T; label: string }[];
  onChange: (id: T | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(value === o.id ? null : o.id)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${
            value === o.id
              ? "bg-sky-600 text-white"
              : "border border-zinc-300 bg-white hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
