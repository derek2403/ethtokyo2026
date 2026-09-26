"use client";

import { useState } from "react";
import { useConnection } from "wagmi";

import { AddressLink, Badge, Button, KV, Notice } from "@/components/ui";
import { useRelayAgentKeys } from "@/lib/hooks/useRelayAgents";
import { type RelayNodeRef, useRelayNode } from "@/lib/hooks/useRelayNode";
import { formatDate, relayTokenCommand, userOf } from "@/lib/relay/browser";
import { describeBundle } from "@/lib/relay/bundle";

import { AddMember } from "./AddMember";
import { AgentTools } from "./AgentTools";
import { CodeBlock, Tabs, Why } from "./Checklist";
import { ManageChild } from "./ManageChild";
import { SubnameSetup } from "./SubnameSetup";
import { NameUsage } from "./Usage";

/** Everything the connected wallet can do with the selected name, and why not when it can't. */
export function NameActions({ nodeRef, onWatch }: { nodeRef: RelayNodeRef; onWatch: (user: string) => void }) {
  const { isConnected } = useConnection();
  const node = useRelayNode(nodeRef);
  const agents = useRelayAgentKeys();
  const [adding, setAdding] = useState(false);

  if (node.loading) return <p className="text-sm text-zinc-500">Loading…</p>;

  const agentKey = node.kind === "agent" ? agents.find(node.owner ?? node.state?.latestOwner) : undefined;
  const ownKeyAgent = node.kind === "agent" && !agentKey && node.active;
  const canAdd = node.iOwn && !!node.subregistry && node.canAddBelow;
  const canEnableBelow = node.iOwn && !node.isRoot && !node.subregistry && node.active;
  const registryNotMine = node.iOwn && !!node.subregistry && !node.canAddBelow;
  const removed = !node.isRoot && !node.active && !node.expired;
  const watchable = node.name ? userOf(node.name) : null;
  const manages =
    (!node.isRoot &&
      (node.active || node.expired) &&
      (node.canRemove || node.canRenew || node.canWriteBundle || node.delegatedCaps.length > 0)) ||
    // A cap delegated on the company owner's resolver also covers the company-wide limit.
    (node.isRoot && node.active && !node.canWriteBundle && node.delegatedCaps.length > 0);
  const mayUse = node.bundleLoading
    ? "…"
    : node.bundleError
      ? "couldn't read (press Refresh to try again)"
      : node.bundle?.plan
        ? `${describeBundle(node.bundle.bundle)} (plan ${node.bundle.plan})`
        : describeBundle(node.bundle?.bundle ?? null);

  return (
    <div className="flex flex-col gap-4 py-2">
      <KV
        rows={[
          [
            "Owner",
            <span key="o" className="inline-flex flex-wrap items-center gap-2">
              <AddressLink address={node.owner ?? node.state?.latestOwner} />
              {node.iOwn && <Badge tone="success">you</Badge>}
              {agentKey && <Badge tone="info">agent key in this browser</Badge>}
            </span>,
          ],
          ["May use", mayUse],
          ["Expires", node.expiry ? formatDate(node.expiry) : "—"],
          ["Names below", node.subregistry ? "enabled" : "not enabled"],
        ]}
      />
      {node.active && node.name && <NameUsage name={node.name} />}

      {watchable && (
        <div>
          <Button variant="secondary" onClick={() => onWatch(watchable)}>
            Watch {watchable === node.name ? "" : `${watchable} `}in the live view
          </Button>
        </div>
      )}

      {!isConnected && <Notice tone="warning">Connect a wallet to act on this name.</Notice>}

      {canAdd && (
        <div className="flex flex-col gap-3">
          {/* Browser-held agent sessions (the older flow) live under More tools. */}
          <Tabs value={adding ? "member" : null} onChange={(v) => setAdding(v === "member")} options={[{ id: "member", label: "Add a member" }]} />
          {adding && <AddMember parent={node} onAdded={onWatch} />}
        </div>
      )}
      {registryNotMine && <Why>Names below {node.name} were set up by another wallet, so you can&apos;t add names there.</Why>}
      {node.iOwn && node.isRoot && !node.subregistry && <Why>Finish &quot;Company setup&quot; to add people.</Why>}

      {canEnableBelow && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Let me add names below {node.name}</h3>
          <Why>For a team lead: you&apos;ll get your own registry and resolver, then you can add people and agents under your name.</Why>
          <SubnameSetup name={node.name!} parentRegistry={node.registry!} withResolver cta="Let me add names below" />
        </div>
      )}

      {manages && <ManageChild node={node} />}

      {/* Keyed on the expiry so a token made before "Extend" isn't kept with the old end time. */}
      {agentKey && <AgentTools key={node.expiry ?? 0} node={node} agentKey={agentKey} />}

      {ownKeyAgent && (
        <div className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <h3 className="text-sm font-semibold">Agent tokens</h3>
          <Why>This agent keeps its own key on the user&apos;s laptop (./relay creates agents there), so it signs its own tokens. On that laptop:</Why>
          <CodeBlock text={relayTokenCommand(node.name!)} />
        </div>
      )}

      {removed && <Why>{node.name} was removed. The level above can add it again.</Why>}
      {node.expired && !node.canRenew && <Why>{node.name} has ended. Only the level above can bring it back.</Why>}
      {isConnected && !removed && !node.expired && !canAdd && !canEnableBelow && !registryNotMine && !manages && !agentKey && !node.isRoot && (
        <Why>Nothing to do here with this wallet: only the level above {node.name} can change it.</Why>
      )}
    </div>
  );
}
