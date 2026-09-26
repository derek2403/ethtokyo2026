"use client";

import { useState } from "react";
import { type Address, type Hex, isAddressEqual, zeroAddress } from "viem";
import { useConnection, useReadContract, useReadContracts } from "wagmi";

import { Badge, Button, Card, Notice } from "@/components/ui";
import { UniversalHelperAbi } from "@/lib/ens/abis/UniversalHelper";
import { UserRegistryImplAbi } from "@/lib/ens/abis/UserRegistryImpl";
import { addresses } from "@/lib/ens/contracts";
import { labelId, splitFirst } from "@/lib/ens/names";
import { decodeDnsName } from "@/lib/ens/permissioned-registry";
import { RegistryRoles } from "@/lib/ens/roles";
import { useNow } from "@/lib/hooks/useNow";
import { useRelayAgentKeys } from "@/lib/hooks/useRelayAgents";
import { useRelayChildren, useRelayRefresh } from "@/lib/hooks/useRelayApi";
import { type RelayNodeRef, useRelayNode } from "@/lib/hooks/useRelayNode";
import { type Role, errorText, formatDate, formatDuration, inactiveLabel, isNever, roleOf } from "@/lib/relay/browser";
import { type Bundle, describeBundle } from "@/lib/relay/bundle";
import type { ChildView, LevelStatus } from "@/lib/relay/types";
import { CHAIN_ID } from "@/lib/wagmi";

import { NameActions } from "./NameActions";

type RowData = {
  name: string;
  registry: Address;
  status: LevelStatus;
  owner: Address | null;
  expiry: number | null;
  subregistry: Address | null;
  bundle: Bundle | null;
  /** The canonical name of this entry's subregistry when it isn't this name (namespace aliasing). */
  aliasOf?: string | null;
  /** Reached through an alias entry above. */
  viaAlias?: boolean;
  /** Replaces the limits summary while they can't be shown (read in flight or failed). */
  limitsNote?: string;
};

type Selection = {
  selected: string | null;
  onSelect: (ref: RelayNodeRef | null) => void;
  onWatch: (user: string) => void;
};

const ROLE_TONE: Record<Role, "neutral" | "info"> = {
  company: "neutral",
  department: "neutral",
  team: "neutral",
  user: "neutral",
  agent: "info",
  subagent: "info",
};

export function TeamTree({ root, ...selection }: { root: string | null } & Selection) {
  const refresh = useRelayRefresh();
  const node = useRelayNode(root ? { name: root, registry: addresses.ETHRegistry } : null);

  if (!root) {
    return (
      <Card title="Team tree">
        <p className="text-sm text-zinc-500">Set a company name first.</p>
      </Card>
    );
  }

  const row: RowData = {
    name: root,
    registry: addresses.ETHRegistry,
    status: node.active ? "registered" : node.state ? "available" : "missing",
    owner: node.owner,
    expiry: node.expiry,
    subregistry: node.subregistry,
    bundle: node.bundle?.bundle ?? null,
    limitsNote: node.bundleLoading ? "…" : node.bundleError ? "limits couldn't be read" : undefined,
  };

  return (
    <Card
      title="Team tree"
      description="Company, departments, teams, users, their agents and subagents. Nothing below can use more than the level above allows, and removing a name cuts off everything under it. Click a name to act on it."
      actions={
        <Button variant="secondary" onClick={() => void refresh()}>
          Refresh
        </Button>
      }
    >
      {node.error && <Notice tone="warning">Couldn&apos;t read {root} from the chain: {errorText(node.error)}</Notice>}
      {node.loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <ul className="flex flex-col">
          <TreeRow row={row} depth={0} defaultOpen {...selection} />
        </ul>
      )}
    </Card>
  );
}

function TreeRow({ row, depth, defaultOpen = false, selected, onSelect, onWatch }: { row: RowData; depth: number; defaultOpen?: boolean } & Selection) {
  const { address } = useConnection();
  const agents = useRelayAgentKeys();
  const [manual, setManual] = useState<boolean | null>(null);
  const isSelected = selected === row.name;
  // A row stays open while something under it is selected, so a newly added name is always visible.
  const holdsSelected = !!selected && selected.endsWith(`.${row.name}`);
  const open = holdsSelected || (manual ?? defaultOpen);
  const live = row.status === "registered";
  const expandable = live && !!row.subregistry;
  const role = roleOf(row.name);
  const agentLike = role === "agent" || role === "subagent";
  const mine = !!address && !!row.owner && isAddressEqual(row.owner, address);
  const keyHere = agentLike && !!agents.find(row.owner);
  // Said once here rather than on every child: the wallet can remove names in this row's registry.
  const managesBelow = useReadContract({
    address: row.subregistry ?? undefined,
    abi: UserRegistryImplAbi,
    functionName: "hasRootRoles",
    args: [RegistryRoles.ROLE_UNREGISTER, (address ?? zeroAddress) as Address],
    chainId: CHAIN_ID,
    query: { enabled: expandable && !!address, refetchOnWindowFocus: false },
  });
  // Removed and expired names both list as available; getState's latestOwner tells them apart.
  const gone = useReadContract({
    address: row.registry,
    abi: UserRegistryImplAbi,
    functionName: "getState",
    args: [labelId(splitFirst(row.name)[0])],
    chainId: CHAIN_ID,
    query: { enabled: !live && role !== "company", refetchOnWindowFocus: false },
  });

  return (
    <li className="flex flex-col">
      <div
        className={`flex items-start gap-2 rounded-md py-1.5 pr-2 ${isSelected ? "bg-sky-50 dark:bg-sky-950/40" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"}`}
        style={{ paddingLeft: `${depth * 1.25 + 0.25}rem` }}
      >
        <button
          type="button"
          onClick={() => {
            if (holdsSelected) onSelect(null);
            setManual(!open);
          }}
          disabled={!expandable}
          className="mt-0.5 w-4 shrink-0 text-xs text-zinc-500 disabled:opacity-0"
          aria-label={open ? "Collapse" : "Expand"}
        >
          {open ? "▾" : "▸"}
        </button>
        <button
          type="button"
          onClick={() => {
            onSelect(isSelected ? null : { name: row.name, registry: row.registry });
            if (expandable) setManual(true);
          }}
          className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
        >
          <span className="flex flex-wrap items-center gap-1.5">
            <span className={`min-w-0 break-all font-mono text-sm ${live ? "" : "text-zinc-400 line-through"}`}>{row.name}</span>
            <Badge tone={ROLE_TONE[role]}>{role}</Badge>
            {!live && <Badge tone="warning">{inactiveLabel(role, gone.data)}</Badge>}
            {live && row.aliasOf && <Badge tone="warning">alias of {row.aliasOf}</Badge>}
            {live && row.viaAlias && <Badge tone="warning">via an alias</Badge>}
            {mine && <Badge tone="success">you</Badge>}
            {managesBelow.data === true && <Badge tone="success">you manage names below</Badge>}
            {keyHere && <Badge tone="info">key in this browser</Badge>}
          </span>
          {live && row.aliasOf && (
            <span className="text-xs text-amber-700 dark:text-amber-400">
              Same group as {row.aliasOf}. Spending only works through {row.aliasOf}; the relay refuses names under this path.
            </span>
          )}
          {live && (
            <span className="flex flex-wrap gap-x-3 text-xs text-zinc-500">
              <span>{row.limitsNote ?? describeBundle(row.bundle)}</span>
              <Expiry expiry={row.expiry} agent={agentLike} />
            </span>
          )}
        </button>
      </div>
      {isSelected && (
        <div className="my-2 border-l-2 border-sky-500 pl-4" style={{ marginLeft: `${depth * 1.25 + 0.75}rem` }}>
          <NameActions nodeRef={{ name: row.name, registry: row.registry }} onWatch={onWatch} />
        </div>
      )}
      {expandable && open && (
        <Children name={row.name} depth={depth + 1} viaAlias={!!row.aliasOf || !!row.viaAlias} selected={selected} onSelect={onSelect} onWatch={onWatch} />
      )}
    </li>
  );
}

function Children({ name, depth, viaAlias, ...selection }: { name: string; depth: number; viaAlias: boolean } & Selection) {
  const children = useRelayChildren(name);
  const registry = children.data?.registry ?? undefined;
  const list = children.data?.children ?? [];

  // Namespace aliasing: an entry can point at another name's registry. findCanonicalName follows
  // the registry's parent pointers, so it names the one path the relay accepts.
  const withSub = list.filter((c) => c.status === "registered" && c.subregistry);
  const canonical = useReadContracts({
    contracts: withSub.map((c) => ({
      address: addresses.UniversalHelper,
      abi: UniversalHelperAbi,
      functionName: "findCanonicalName" as const,
      args: [c.subregistry!] as const,
      chainId: CHAIN_ID,
    })),
    query: { enabled: withSub.length > 0, refetchOnWindowFocus: false, staleTime: 30_000 },
  });
  const aliasOf = new Map<string, string>();
  withSub.forEach((c, i) => {
    const raw = canonical.data?.[i]?.result as Hex | undefined;
    const found = raw && raw !== "0x" ? decodeDnsName(raw) : null;
    if (found && found !== c.name) aliasOf.set(c.name, found);
  });

  const pad = { paddingLeft: `${depth * 1.25 + 1.5}rem` };
  if (children.isLoading) return <p className="py-1 text-xs text-zinc-500" style={pad}>Loading…</p>;
  if (children.error) {
    return (
      <p className="py-1 text-xs text-amber-600" style={pad}>
        Couldn&apos;t load names under {name}: {errorText(children.error)}
      </p>
    );
  }
  if (!registry) return null;
  if (list.length === 0) return <p className="py-1 text-xs text-zinc-500" style={pad}>No one here yet.</p>;

  const rows = list
    .map(
      (c: ChildView): RowData => ({
        name: c.name,
        registry,
        status: c.status,
        owner: c.owner,
        expiry: c.expiry,
        subregistry: c.subregistry,
        bundle: c.bundle,
        aliasOf: aliasOf.get(c.name) ?? null,
        viaAlias,
      }),
    )
    .sort((a, b) => Number(b.status === "registered") - Number(a.status === "registered") || a.name.localeCompare(b.name));

  return (
    <ul className="flex flex-col">
      {rows.map((r) => (
        <TreeRow key={r.name} row={r} depth={depth} {...selection} />
      ))}
    </ul>
  );
}

function Expiry({ expiry, agent }: { expiry: number | null; agent: boolean }) {
  const now = useNow();
  if (!expiry) return null;
  if (isNever(expiry)) return <span>no end date</span>;
  if (!agent) return <span>until {new Date(expiry * 1000).toLocaleDateString()}</span>;
  if (!now) return <span title={formatDate(expiry)}>ends {formatDate(expiry)}</span>;
  const left = expiry - now;
  return (
    <span title={formatDate(expiry)} className={left < 300 ? "text-amber-600" : ""}>
      {left > 0 ? `ends in ${formatDuration(left)}` : "ended"}
    </span>
  );
}
