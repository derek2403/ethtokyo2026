"use client";

import { Input, Select } from "@/components/ui";
import { type BundleDraft, type LevelBundle, type LimitsAbove, limitsAbove } from "@/lib/relay/browser";
import { PERIODS, type Period } from "@/lib/relay/bundle";
import { CATALOG, CATEGORY_LABELS, type Category, type ProviderId, countUnit } from "@/lib/relay/catalog";

const PERIOD_LABELS: Record<Period, string> = {
  month: "per month",
  day: "per day",
  total: "in total (never resets)",
};

const CATEGORIES = Object.keys(CATEGORY_LABELS) as Category[];

const listOf = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

const number = (raw: string | undefined) => {
  const n = Number((raw ?? "").trim().replace(/^\$/, ""));
  return (raw ?? "").trim() !== "" && Number.isFinite(n) ? n : null;
};

/**
 * Which APIs a name may use, with a dollar cap (APIs the relay can price) and
 * a count limit (requests, or images) for each, and when they reset.
 *
 * `above` is every level above the name, company first (undefined for the
 * company itself, null while it's still loading). Nothing here can widen what
 * those levels allow, so APIs they block aren't offered, and limits above
 * theirs are flagged.
 */
export function BundleEditor({
  value,
  onChange,
  above,
}: {
  value: BundleDraft;
  onChange: (next: BundleDraft) => void;
  above?: LevelBundle[] | null;
}) {
  const limits = new Map(CATALOG.map((p) => [p.id as ProviderId, above ? limitsAbove(above, p.id) : null]));
  const blocked = (id: ProviderId) => !!limits.get(id)?.blockedBy;
  // Already-ticked APIs stay visible even when blocked, so they can be unticked.
  const shown = CATALOG.filter((p) => !blocked(p.id) || value.keys.includes(p.id));
  const hidden = CATALOG.filter((p) => blocked(p.id) && !value.keys.includes(p.id));

  // "Stripe and Notion aren't available: dev.eng.acme.eth doesn't allow them."
  const byLevel = new Map<string, string[]>();
  for (const p of hidden) {
    const by = limits.get(p.id)!.blockedBy!;
    byLevel.set(by, [...(byLevel.get(by) ?? []), p.label]);
  }

  const toggle = (id: ProviderId, on: boolean) => onChange({ ...value, keys: on ? [...value.keys, id] : value.keys.filter((k) => k !== id) });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      {above === null && <p className="text-xs text-zinc-500">Checking what the levels above allow…</p>}
      {CATEGORIES.map((cat) => {
        const rows = shown.filter((p) => p.category === cat);
        if (rows.length === 0) return null;
        return (
          <div key={cat} className="flex flex-col gap-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{CATEGORY_LABELS[cat]}</h4>
            {rows.map((p) => (
              <ProviderRow
                key={p.id}
                id={p.id}
                label={p.label}
                dollarCaps={p.dollarCaps}
                on={value.keys.includes(p.id)}
                cap={value.caps[p.id] ?? ""}
                max={value.maxes[p.id] ?? ""}
                limits={limits.get(p.id) ?? null}
                onToggle={(on) => toggle(p.id, on)}
                onCap={(v) => onChange({ ...value, caps: { ...value.caps, [p.id]: v } })}
                onMax={(v) => onChange({ ...value, maxes: { ...value.maxes, [p.id]: v } })}
              />
            ))}
          </div>
        );
      })}
      {[...byLevel].map(([by, labels]) => (
        <p key={by} className="text-xs text-zinc-500">
          {listOf(labels)} {labels.length === 1 ? "isn't" : "aren't"} available: {by} doesn&apos;t allow {labels.length === 1 ? "it" : "them"}.
        </p>
      ))}
      <label className="flex items-center gap-2 text-sm">
        <span className="text-zinc-500">Limits reset</span>
        <Select value={value.period} onChange={(e) => onChange({ ...value, period: e.target.value as Period })} className="w-auto! py-1!">
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {PERIOD_LABELS[p]}
            </option>
          ))}
        </Select>
      </label>
    </div>
  );
}

function ProviderRow({
  id,
  label,
  dollarCaps,
  on,
  cap,
  max,
  limits,
  onToggle,
  onCap,
  onMax,
}: {
  id: ProviderId;
  label: string;
  dollarCaps: boolean;
  on: boolean;
  cap: string;
  max: string;
  limits: LimitsAbove | null;
  onToggle: (on: boolean) => void;
  onCap: (v: string) => void;
  onMax: (v: string) => void;
}) {
  const unit = countUnit(id);
  const capAbove = limits?.cap ?? null;
  const maxAbove = limits?.max ?? null;
  const capNum = number(cap);
  const maxNum = number(max);
  const notes = [
    on && limits?.blockedBy ? `Blocked above: ${limits.blockedBy} doesn't allow it.` : null,
    on && dollarCaps && capAbove && capNum !== null && capNum > capAbove.value ? `Capped by ${capAbove.by} at $${capAbove.value}.` : null,
    on && maxAbove && maxNum !== null && maxNum > maxAbove.value ? `Capped by ${maxAbove.by} at ${maxAbove.value} ${unit}.` : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <label className="flex min-w-48 flex-1 items-center gap-2">
          <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} />
          <span>{label}</span>
        </label>
        {dollarCaps && (
          <span className="flex items-center gap-1" title="Dollar cap for the period (empty: no cap at this level)">
            <span className="text-zinc-500">$</span>
            <Input
              value={cap}
              onChange={(e) => onCap(e.target.value)}
              placeholder={capAbove ? `≤ ${capAbove.value}` : "no cap"}
              disabled={!on}
              inputMode="decimal"
              aria-label={`${label} dollar cap`}
              className="w-20! py-1!"
            />
          </span>
        )}
        <span className="flex items-center gap-1" title={`Most ${unit} for the period (empty: no limit at this level)`}>
          <Input
            value={max}
            onChange={(e) => onMax(e.target.value)}
            placeholder={maxAbove ? `≤ ${maxAbove.value}` : "no limit"}
            disabled={!on}
            inputMode="numeric"
            aria-label={`${label} ${unit} limit`}
            className="w-20! py-1!"
          />
          <span className="w-16 text-xs text-zinc-500">{unit}</span>
        </span>
      </div>
      {notes.map((n) => (
        <span key={n} className="pl-6 text-xs text-amber-600 dark:text-amber-400">
          {n}
        </span>
      ))}
    </div>
  );
}
