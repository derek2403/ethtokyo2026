"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type Address, zeroAddress } from "viem";
import { useConnection, useReadContract, useWriteContract } from "wagmi";

import { TxButton, TxStatus } from "@/components/Tx";
import { Badge, Button, Card, Notice, Row, Select } from "@/components/ui";
import { UserRegistryImplAbi } from "@/lib/ens/abis/UserRegistryImpl";
import { labelId, splitFirst } from "@/lib/ens/names";
import { RegistryRoles } from "@/lib/ens/roles";
import { useRelayChildren, useRelayLog, useRelayRefresh, useRelayStatus } from "@/lib/hooks/useRelayApi";
import { LIVE_POLL_MS, type LiveData, subtreeNames, useRelayLive, wasSeenLive } from "@/lib/hooks/useRelayLive";
import { useTx } from "@/lib/hooks/useTx";
import {
  ADMIN_SIGN_IN,
  type LiveState,
  type Role,
  depthOf,
  errorText,
  formatDate,
  formatDuration,
  isNever,
  liveCandidates,
  liveState,
  needsSignIn,
  parentOf,
  roleOf,
  usd,
} from "@/lib/relay/browser";
import { type ProviderId, isProviderId } from "@/lib/relay/catalog";
import type { LevelView, LogEntry } from "@/lib/relay/types";
import { CHAIN_ID } from "@/lib/wagmi";

import { Why } from "./Checklist";
import { ProviderUsage } from "./Usage";

/** Where demo users are added: dev.eng.<company>. */
const DEFAULT_TEAM = "dev.eng";

const STATE_BADGE: Record<LiveState, { tone: "success" | "neutral" | "danger" | "warning"; text: string }> = {
  live: { tone: "success", text: "live" },
  ended: { tone: "warning", text: "ended" },
  revoked: { tone: "danger", text: "revoked" },
  gone: { tone: "neutral", text: "not registered" },
  unknown: { tone: "neutral", text: "…" },
};

const stateOf = (data: LiveData, name: string, now: number): LiveState =>
  liveState(data.levels[name], name in data.liveExpiry ? data.liveExpiry[name] : undefined, now);

/** The relay's own words: "killed: …" when it cut off a call in flight, "access revoked: …" when it refused one. */
const outcome = (e: LogEntry): { tone: "success" | "danger"; text: string; loud: boolean } => {
  const reason = e.reason ?? "";
  if (/^killed/i.test(reason)) return { tone: "danger", text: "killed", loud: true };
  if (/revoked/i.test(reason)) return { tone: "danger", text: "revoked", loud: true };
  return e.allowed ? { tone: "success", text: `ok${e.status ? ` ${e.status}` : ""}`, loud: false } : { tone: "danger", text: "refused", loud: false };
};

/**
 * The demo's main screen: one user, its agents and their subagents, with
 * spend against caps and counts against limits for every API, the relay's
 * latest decisions for them, and a Remove button.
 */
export function LiveView({ root, watch, onWatch }: { root: string | null; watch: string | null; onWatch: (user: string) => void }) {
  const watched = root && watch && watch.endsWith(`.${root}`) && depthOf(watch) === 3 ? watch : null;
  const team = watched ? parentOf(watched) : root ? `${DEFAULT_TEAM}.${root}` : null;
  const { address } = useConnection();
  const status = useRelayStatus();
  const queryClient = useQueryClient();
  const teamList = useRelayChildren(team);
  // Without a pick, the newest user, skipping levels the admin holds itself (like the launch squad).
  // Waits for the status, which names the root's owner, so the squad doesn't flash up first.
  const users = status.isLoading
    ? []
    : liveCandidates(teamList.data?.children ?? [], {
        admins: [address, status.data?.rootOwner],
        seenLive: (name) => wasSeenLive(queryClient, name),
      });
  const user = watched ?? users[0] ?? null;

  const live = useRelayLive(user);
  const log = useRelayLog(50, LIVE_POLL_MS);
  const data = live.data?.user === user ? live.data : undefined;

  if (!root) {
    return (
      <Card title="Live view">
        <Why>Set a company name first.</Why>
      </Card>
    );
  }

  const signIn = needsSignIn(live.error) || needsSignIn(log.error);
  const options = [...new Set([...(user ? [user] : []), ...users])];

  return (
    <Card title="Live view" description="A user, their agents and subagents: what each has spent against its limits, updated every 3 seconds.">
      {options.length > 1 && (
        <label className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
          <span className="text-zinc-500">Watching</span>
          <Select value={user ?? ""} onChange={(e) => onWatch(e.target.value)} className="w-auto! max-w-full py-1! font-mono" aria-label="User to watch">
            {options.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </label>
      )}
      {signIn && (
        <Notice tone="warning" title="Sign in to see spend">
          The relay only shows spend and its log to the admin.{" "}
          {/* A route handler that serves its own HTML, not a Next page, so it needs a full page load. */}
          <a href={ADMIN_SIGN_IN} className="font-semibold underline">
            Sign in as admin
          </a>
        </Notice>
      )}
      {!user ? (
        <Why>
          {teamList.isLoading || status.isLoading
            ? "Looking for users…"
            : `No users yet. In the team tree, open ${team} and click "Add a member"; they show up here.`}
        </Why>
      ) : !data ? (
        live.error && !signIn ? (
          <Notice tone="warning">Couldn&apos;t read {user}: {errorText(live.error)}</Notice>
        ) : (
          !signIn && <Why>Loading {user}…</Why>
        )
      ) : (
        <Subtree
          data={data}
          error={live.error}
          // Pinned, so the view stays on the removed user and shows what was cut off.
          onRemoved={() => {
            onWatch(data.user);
            void live.refetch();
          }}
          log={log.data}
          logError={signIn ? null : log.error}
        />
      )}
    </Card>
  );
}

function Subtree({
  data,
  error,
  onRemoved,
  log,
  logError,
}: {
  data: LiveData;
  error: Error | null;
  onRemoved: () => void;
  log: LogEntry[] | undefined;
  logError: Error | null;
}) {
  const now = Math.floor(data.updatedAt / 1000);
  const names = subtreeNames(data.user, data.kids);
  const userLevel = data.levels[data.user];
  const userState = stateOf(data, data.user, now);
  // Above the user: its team, department and company, showing only the APIs the user has.
  const above = aboveLevels(data);
  const userKeys = (userLevel?.bundle?.keys ?? []).filter(isProviderId);
  const entries = (log ?? [])
    .filter((e) => e.ts >= data.since && e.name && (e.name === data.user || e.name.endsWith(`.${data.user}`)))
    .slice(0, 8);

  // Already gone when this page opened (e.g. removed by demo:reset): nothing was revoked here.
  if (userState === "gone") return <Why>{data.user} isn&apos;t registered.</Why>;

  return (
    <div className="flex flex-col gap-4">
      {userState === "revoked" && (
        <Notice tone="danger" title={`${data.user} was removed`}>
          Every name below it is cut off: their next call is refused, and anything still streaming stops within seconds.
        </Notice>
      )}

      <ul className="flex flex-col gap-2">
        {names.map((name) => (
          <LiveRow key={name} name={name} level={data.levels[name] ?? null} state={stateOf(data, name, now)} now={now} depth={depthOf(name) - 3} />
        ))}
      </ul>

      {above.length > 0 && userKeys.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
          <span className="text-xs font-semibold text-zinc-500">Above {data.user.split(".")[0]}: every call also counts here</span>
          {above.map((level) => (
            <div key={level.name} className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-4">
              <span className="w-56 shrink-0 text-xs">
                <span className="font-mono">{level.name}</span> <span className="text-zinc-500">{roleOf(level.name)}</span>
              </span>
              <div className="grid flex-1 grid-cols-2 gap-3 md:grid-cols-4">
                {userKeys
                  .filter((p) => level.bundle?.keys.includes(p) && limitedOrUsed(level, p))
                  .map((p) => (
                    <ProviderUsage key={p} level={level} provider={p} />
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <Why>Last update failed ({errorText(error)}); showing what was read before.</Why>}
      {!error && data.partialError && <Why>Some names couldn&apos;t be read this time ({data.partialError}).</Why>}

      <Decisions entries={entries} error={logError} />

      {userState === "live" && userLevel?.registry && <RemoveUser user={data.user} registry={userLevel.registry} below={names.length - 1} onRemoved={onRemoved} />}
    </div>
  );
}

/** Above the user, an API is worth a line only where that level limits it or something was spent. */
const limitedOrUsed = (level: LevelView, p: ProviderId) =>
  level.bundle?.caps[p] !== undefined || level.bundle?.maxes?.[p] !== undefined || (level.spent[p] ?? 0) > 0 || (level.used?.[p] ?? 0) > 0;

function aboveLevels(data: LiveData): LevelView[] {
  const labels = data.user.split(".");
  const out: LevelView[] = [];
  // Team, department, company: nearest first, as the eye moves up from the user.
  for (let i = 1; i < labels.length - 1; i++) {
    const level = data.levels[labels.slice(i).join(".")];
    if (level) out.push(level);
  }
  return out;
}

function LiveRow({ name, level, state, now, depth }: { name: string; level: LevelView | null; state: LiveState; now: number; depth: number }) {
  const role: Role = roleOf(name);
  const keys = (level?.bundle?.keys ?? []).filter(isProviderId) as ProviderId[];
  const badge = STATE_BADGE[state];
  const dim = state !== "live";
  const expiry = level?.expiry ?? null;

  return (
    <li className={`flex flex-col gap-2 rounded-lg border p-3 ${state === "revoked" ? "border-red-200 dark:border-red-900" : "border-zinc-200 dark:border-zinc-800"}`} style={{ marginLeft: `${depth * 1.5}rem` }}>
      <div className="flex flex-wrap items-center gap-2">
        {depth > 0 && <span className="text-zinc-400">└</span>}
        <span className={`min-w-0 break-all font-mono text-sm ${state === "revoked" ? "text-zinc-400 line-through" : ""}`}>{name}</span>
        <Badge tone={role === "user" ? "neutral" : "info"}>{role}</Badge>
        <Badge tone={badge.tone}>{badge.text}</Badge>
        {state === "live" && expiry && !isNever(expiry) && (
          <span className="text-xs text-zinc-500" title={formatDate(expiry)}>
            {role === "user" ? `until ${new Date(expiry * 1000).toLocaleDateString()}` : `ends in ${formatDuration(expiry - now)}`}
          </span>
        )}
        {level?.bundle?.period && <span className="text-xs text-zinc-500">limits {level.bundle.period === "total" ? "in total" : `per ${level.bundle.period}`}</span>}
      </div>
      {keys.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {keys.map((p) => (
            <ProviderUsage key={p} level={level!} provider={p} dim={dim} />
          ))}
        </div>
      ) : (
        level && <span className="text-xs text-zinc-500">No limits set: the relay refuses every call.</span>
      )}
    </li>
  );
}

function Decisions({ entries, error }: { entries: LogEntry[]; error: Error | null }) {
  return (
    <div className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <h3 className="text-sm font-semibold">Latest relay decisions</h3>
      {error ? (
        <Why>Couldn&apos;t load the log: {errorText(error)}</Why>
      ) : entries.length === 0 ? (
        <Why>No calls yet from these names.</Why>
      ) : (
        <ul className="flex flex-col gap-1 text-xs">
          {entries.map((e, i) => {
            const o = outcome(e);
            return (
              <li key={`${e.ts}-${i}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="w-20 shrink-0 tabular-nums text-zinc-500">{new Date(e.ts).toLocaleTimeString()}</span>
                <span className="min-w-0 break-all font-mono">{e.name}</span>
                <span className="text-zinc-500">{e.provider}</span>
                <Badge tone={o.tone}>{o.text}</Badge>
                {e.reason && <span className={o.loud ? "font-medium text-red-600 dark:text-red-400" : "text-zinc-500"}>{e.reason}</span>}
                {e.costUsd !== null && e.costUsd > 0 && (
                  <span className="tabular-nums text-zinc-500">
                    {usd(e.costUsd)}
                    {e.estimated ? " (est.)" : ""}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** unregister on the team's registry: the user and everything below become unreachable at once. */
function RemoveUser({ user, registry, below, onRemoved }: { user: string; registry: Address; below: number; onRemoved: () => void }) {
  const { address, isConnected } = useConnection();
  const { mutateAsync } = useWriteContract();
  // The team's registry owner holds ROLE_UNREGISTER on its root, which covers every name in it.
  const canRemove = useReadContract({
    address: registry,
    abi: UserRegistryImplAbi,
    functionName: "hasRootRoles",
    args: [RegistryRoles.ROLE_UNREGISTER, (address ?? zeroAddress) as Address],
    chainId: CHAIN_ID,
    query: { enabled: !!address },
  });
  const refresh = useRelayRefresh();
  const tx = useTx();
  const [confirming, setConfirming] = useState(false);
  const [label] = splitFirst(user);

  const remove = async () => {
    const r = await tx.run(() => mutateAsync({ address: registry, abi: UserRegistryImplAbi, functionName: "unregister", args: [labelId(label)], chainId: CHAIN_ID }));
    setConfirming(false);
    if (r) {
      onRemoved();
      await refresh();
    }
  };

  const blocked = !isConnected
    ? "Connect the admin wallet to remove this user."
    : canRemove.data === false
      ? `This wallet can't remove names under ${parentOf(user)}.`
      : null;

  return (
    <div className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      {!confirming ? (
        <div>
          <Button variant="danger" onClick={() => setConfirming(true)} disabled={!!blocked || canRemove.data !== true || tx.busy} className="px-5 py-2.5 text-base">
            Remove {user}
          </Button>
        </div>
      ) : (
        <Notice tone="danger" title={`Remove ${user}?`}>
          <p className="mb-3">
            It stops working right away{below > 0 ? `, and so ${below === 1 ? "does the name" : `do the ${below} names`} under it` : ""}. No keys to rotate.
          </p>
          <Row>
            <TxButton tx={tx} variant="danger" onClick={remove}>
              Yes, remove it
            </TxButton>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={tx.busy}>
              Cancel
            </Button>
          </Row>
        </Notice>
      )}
      {blocked && <Why>{blocked}</Why>}
      <TxStatus tx={tx} showEvents={false} />
    </div>
  );
}
