"use client";

import { useRelayPolicy } from "@/lib/hooks/useRelayApi";
import { ADMIN_SIGN_IN, needsSignIn, usd } from "@/lib/relay/browser";
import { type ProviderId, catalogEntry, countUnit } from "@/lib/relay/catalog";
import type { LevelView } from "@/lib/relay/types";

/** A thin bar: green, amber from 80 %, red when full. */
export function Meter({ value, max, dim = false }: { value: number; max: number; dim?: boolean }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : value > 0 ? 100 : 0;
  const tone = dim ? "bg-zinc-400" : pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" role="meter" aria-valuenow={value} aria-valuemax={max}>
      <div className={`h-full rounded-full transition-[width] duration-700 ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** How much of one API a level has used this period: dollars against its cap, and a count against its limit. */
export function ProviderUsage({ level, provider, dim = false }: { level: LevelView; provider: ProviderId; dim?: boolean }) {
  const entry = catalogEntry(provider);
  const cap = level.bundle?.caps[provider];
  const max = level.bundle?.maxes?.[provider];
  const spent = level.spent[provider] ?? 0;
  const used = level.used?.[provider] ?? 0;
  // "0 of 1 image", "3 of 5 images".
  const unit = (n: number) => (n === 1 ? countUnit(provider).replace(/s$/, "") : countUnit(provider));
  // Dollars for APIs the relay can price, unless only a count limit is set; counts when limited or not priced.
  const showDollars = entry.dollarCaps && (cap !== undefined || max === undefined);
  const showCount = max !== undefined || !entry.dollarCaps;

  return (
    <div className={`flex min-w-0 flex-col gap-1 ${dim ? "opacity-60" : ""}`}>
      <span className="truncate text-xs font-medium">{entry.label}</span>
      {showDollars &&
        (cap !== undefined ? (
          <>
            <span className="text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
              {usd(spent)} of {usd(cap)}
            </span>
            <Meter value={spent} max={cap} dim={dim} />
          </>
        ) : (
          <span className="text-xs tabular-nums text-zinc-600 dark:text-zinc-400">{usd(spent)} spent, no cap here</span>
        ))}
      {showCount &&
        (max !== undefined ? (
          <>
            <span className="text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
              {used} of {max} {unit(max)}
            </span>
            <Meter value={used} max={max} dim={dim} />
          </>
        ) : (
          <span className="text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
            {used} {unit(used)}, no limit here
          </span>
        ))}
    </div>
  );
}

/** This period's usage of one name, per API it may use (for the selected name in the tree). */
export function NameUsage({ name }: { name: string }) {
  const policy = useRelayPolicy(name);
  const level = policy.data?.levels.find((l) => l.name === name);
  if (policy.error) {
    return needsSignIn(policy.error) ? (
      <p className="text-xs text-zinc-500">
        {/* A route handler that serves its own HTML, not a Next page, so it needs a full page load. */}
        <a href={ADMIN_SIGN_IN} className="text-sky-600 hover:underline dark:text-sky-400">
          Sign in as admin
        </a>{" "}
        to see spend.
      </p>
    ) : null;
  }
  if (!level?.bundle?.keys.length) return null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {level.bundle.keys.map((p) => (
        <ProviderUsage key={p} level={level} provider={p} />
      ))}
    </div>
  );
}
