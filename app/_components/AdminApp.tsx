"use client";

import { useState } from "react";

import { addresses } from "@/lib/ens/contracts";
import { tryNormalize } from "@/lib/ens/names";
import { useLocalJson } from "@/lib/hooks/useLocalJson";
import { useRelayStatus } from "@/lib/hooks/useRelayApi";
import { type RelayNodeRef, useRelayNode } from "@/lib/hooks/useRelayNode";
import { DRAFT_ROOT_STORAGE, companySetupFirst } from "@/lib/relay/browser";

import { CompanySetup } from "./CompanySetup";
import { Delegates } from "./Delegates";
import { DnsAlias } from "./DnsAlias";
import { LiveView } from "./LiveView";
import { MoreTools } from "./MoreTools";
import { Plans } from "./Plans";
import { SessionMinterCard } from "./SessionMinterCard";
import { StartSessionCard } from "./StartSession";
import { StatusLine } from "./StatusLine";
import { TeamTree } from "./TeamTree";
import { TryCall } from "./TryCall";

/**
 * The admin page. First screen: the relay status, the live view of one user
 * and the team tree. Company setup comes first until it's done; everything
 * else sits under "More tools".
 */
export function AdminApp() {
  const status = useRelayStatus();
  const [draftRoot, setDraftRoot] = useLocalJson<string>(DRAFT_ROOT_STORAGE, "");
  // Not kept across reloads: a fresh page starts on the newest user, or "No users yet".
  const [watch, setWatch] = useState<string | null>(null);
  const [selected, setSelected] = useState<RelayNodeRef | null>(null);

  // RELAY_ROOT_NAME wins; until it's set, the page works on the name typed here. The company
  // root is a .eth name held in ETHRegistry, so anything deeper can't be the root.
  const draft = tryNormalize(draftRoot);
  const draftOk = !!draft && /^[^.]+\.eth$/.test(draft);
  const root = status.data?.root ?? (draftOk ? draft : null);

  // Plans and the Session Minter act on "your" level: the selected name if you own it with
  // people under it, otherwise the company root if it's yours.
  const rootNode = useRelayNode(root ? { name: root, registry: addresses.ETHRegistry } : null);
  const selectedNode = useRelayNode(selected && selected.name !== root ? selected : null);
  const myNode =
    selectedNode.name && selectedNode.iOwn && selectedNode.subregistry
      ? selectedNode
      : rootNode.iOwn && rootNode.subregistry
        ? rootNode
        : null;

  // Set up = the relay can serve the company: registered, limits written, names can go below.
  const setupFirst = companySetupFirst(root, {
    active: rootNode.active,
    subregistry: rootNode.subregistry,
    hasBundle: !!rootNode.bundle?.bundle,
    loading: rootNode.loading,
    bundleLoading: rootNode.bundleLoading,
    error: rootNode.error,
    bundleError: rootNode.bundleError,
  });
  const setup = <CompanySetup root={root} status={status.data} onRegistered={(name) => !status.data?.root && setDraftRoot(name)} />;

  return (
    <div className="flex flex-col gap-6">
      <StatusLine
        status={status.data}
        error={status.error}
        loading={status.isLoading}
        draftRoot={draftRoot}
        draftProblem={draftRoot.trim() && !draftOk ? "The company name must be a .eth name like acme.eth." : null}
        onDraftRoot={(v) => setDraftRoot(v)}
      />
      {setupFirst && setup}
      <LiveView root={root} watch={watch} onWatch={setWatch} />
      <TeamTree root={root} selected={selected?.name ?? null} onSelect={setSelected} onWatch={setWatch} />
      <MoreTools summary={`Plans, delegates, Session Minter, browser agent session, try a call, company domain${setupFirst ? "" : ", company setup"}`}>
        {!setupFirst && setup}
        <Plans myNode={myNode} />
        <Delegates myNode={myNode} companyResolver={rootNode.resolver} />
        <SessionMinterCard myNode={myNode} />
        <StartSessionCard myNode={myNode} onStarted={setSelected} />
        <TryCall root={root} />
        <DnsAlias root={root} alias={status.data?.dnsAlias} />
      </MoreTools>
    </div>
  );
}
