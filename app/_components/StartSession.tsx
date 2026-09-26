"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { type Address, isAddress, zeroAddress } from "viem";
import { useBytecode, usePublicClient, useReadContract, useWriteContract } from "wagmi";

import { TxButton, TxStatus } from "@/components/Tx";
import { AddressLink, Badge, Card, ErrorText, Field, Input, Row, Select } from "@/components/ui";
import { PermissionedResolverImplAbi } from "@/lib/ens/abis/PermissionedResolverImpl";
import { UserRegistryImplAbi } from "@/lib/ens/abis/UserRegistryImpl";
import { labelId, tryNormalize } from "@/lib/ens/names";
import { RegistryRoles } from "@/lib/ens/roles";
import { useMyResolver } from "@/lib/hooks/useMyResolver";
import { useRelayAgentKeys } from "@/lib/hooks/useRelayAgents";
import { useRelayRefresh, useRelayStatus } from "@/lib/hooks/useRelayApi";
import { useRelayLevels } from "@/lib/hooks/useRelayLevels";
import { useRelayMinter } from "@/lib/hooks/useRelayMinter";
import type { RelayNode, RelayNodeRef } from "@/lib/hooks/useRelayNode";
import { useTx } from "@/lib/hooks/useTx";
import {
  AGENT_CLI,
  type BundleDraft,
  CONTRACT_OWNER_WARNING,
  DEMO_KEY_WARNING,
  SESSION_DURATIONS,
  type StoredAgentKey,
  bundleCalls,
  bundleFromDraft,
  chainNow,
  defaultBundle,
  draftFromBundle,
  newAgentKey,
  readBundle,
} from "@/lib/relay/browser";
import { SessionMinterAbi } from "@/lib/relay/sessionMinter";
import { CHAIN_ID } from "@/lib/wagmi";

import { BundleEditor } from "./BundleEditor";
import { Check, Checklist, CodeBlock, Why } from "./Checklist";

type KeyMode = "generate" | "paste";

/**
 * An agent session is a name owned by the agent's key, with no roles and an
 * expiry: when it expires (or is removed) the agent is cut off.
 */
export function StartSession({ parent, onStarted }: { parent: RelayNode; onStarted: (name: string) => void }) {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const { mutateAsync } = useWriteContract();
  const my = useMyResolver();
  const agents = useRelayAgentKeys();
  const minter = useRelayMinter(parent.subregistry, my.resolver ?? null);
  const status = useRelayStatus();
  const refresh = useRelayRefresh();
  const tx = useTx();
  // The session's levels above: the parent and everything over it, company first.
  const chain = useRelayLevels(parent.name);
  const above = chain.levels ?? (chain.error ? undefined : null);

  const [labelInput, setLabelInput] = useState("");
  const [keyMode, setKeyMode] = useState<KeyMode>("generate");
  const [pasted, setPasted] = useState("");
  const [duration, setDuration] = useState<string>(String(SESSION_DURATIONS[1].seconds));
  const [customMinutes, setCustomMinutes] = useState("30");
  const [draft, setDraft] = useState<BundleDraft | null>(null);
  const [pendingKey, setPendingKey] = useState<StoredAgentKey | null>(null);

  const normalized = tryNormalize(labelInput);
  const label = normalized && !normalized.includes(".") ? normalized : null;
  const childName = label ? `${label}.${parent.name}` : null;
  const seconds = duration === "custom" ? Math.round(Number(customMinutes) * 60) : Number(duration);

  // Sessions default to a one-off budget ("total"), inside whatever the parent allows.
  const value = draft ?? draftFromBundle(defaultBundle(parent.bundle?.bundle ?? null, "total", above ?? undefined));
  const parsed = bundleFromDraft(value);

  const state = useReadContract({
    address: parent.subregistry ?? undefined,
    abi: UserRegistryImplAbi,
    functionName: "getState",
    args: [labelId(label ?? "")],
    chainId: CHAIN_ID,
    query: { enabled: !!parent.subregistry && !!label },
  });
  const childBundle = useQuery({
    queryKey: ["relay-bundle", my.resolver, childName],
    queryFn: () => readBundle(client!, my.resolver!, childName!),
    enabled: !!client && my.deployed && !!childName,
  });

  const s = state.data;
  const registered = s?.status === 2;
  const pastedOk = isAddress(pasted);

  // A registered label with no limits on your resolver may be your own half-finished session,
  // but only if its owner is an agent (no ROLE_SET_SUBREGISTRY on the name) or a key kept here;
  // a member whose "Add member" stopped after step 1 must not get agent-style limits.
  const ownerIsMember = useReadContract({
    address: parent.subregistry ?? undefined,
    abi: UserRegistryImplAbi,
    functionName: "hasRoles",
    args: [labelId(label ?? ""), RegistryRoles.ROLE_SET_SUBREGISTRY, s?.latestOwner ?? zeroAddress],
    chainId: CHAIN_ID,
    query: { enabled: !!parent.subregistry && registered },
  });
  const pastedCode = useBytecode({ address: pastedOk ? (pasted as Address) : undefined, chainId: CHAIN_ID, query: { enabled: pastedOk } });
  const pastedIsContract = !!pastedCode.data && pastedCode.data !== "0x";

  const resumeKey = registered ? s.latestOwner : null;
  const checking = registered && (childBundle.isLoading || ownerIsMember.isLoading);
  const resumable =
    !!resumeKey &&
    childBundle.isSuccess &&
    !childBundle.data.bundle &&
    (ownerIsMember.data === false || !!agents.find(resumeKey));
  // The minter only writes setText/setAddress and can't detach a name from a plan's shared
  // record, so it is used only once the read shows the label's old record isn't on a plan.
  const oneTx = minter.ready && !registered && childBundle.isSuccess && !childBundle.data.plan;

  const problem = !label
    ? labelInput && "Use one simple label, like \"laptop\"."
    : checking
      ? null
      : registered && childBundle.isError
        ? `Couldn't read the limits of ${childName}. Press Refresh in the team tree to try again.`
        : registered && !resumable
          ? `${childName} is already taken.`
          : !(seconds > 0)
            ? "Pick how long."
            : keyMode === "paste" && !registered && !pastedOk
              ? pasted && "That isn't an address."
              : parsed.error;

  const start = async () => {
    if (!label || !childName || !parsed.bundle || !my.resolver || !parent.subregistry) return;
    let agent: Address;
    if (resumeKey) agent = resumeKey;
    else if (keyMode === "paste") agent = pasted as Address;
    else {
      // Saved before any transaction, so a reload never loses a key that may end up owning a name.
      const key = pendingKey?.name === childName ? pendingKey : newAgentKey(childName);
      if (key !== pendingKey) {
        setPendingKey(key);
        agents.add(key);
      }
      agent = key.address;
    }
    const expiry = BigInt((await chainNow(client!)) + seconds);

    if (oneTx) {
      const calls = bundleCalls(childName, parsed.bundle, { agent });
      const r = await tx.run(() =>
        mutateAsync({
          address: minter.minter!,
          abi: SessionMinterAbi,
          functionName: "startSession",
          args: [parent.subregistry!, my.resolver!, label, agent, expiry, calls],
          chainId: CHAIN_ID,
        }),
      );
      if (!r) return;
    } else {
      if (!registered) {
        const r = await tx.run(() =>
          mutateAsync({
            address: parent.subregistry!,
            abi: UserRegistryImplAbi,
            functionName: "register",
            // Agents get no roles on their own name: they can't re-point, transfer or extend it.
            args: [label, agent, zeroAddress, my.resolver!, 0n, expiry],
            chainId: CHAIN_ID,
          }),
        );
        if (!r) return;
        await state.refetch();
      }
      // Always detach first (you hold ROLE_LINK on your own resolver): a re-used label's old
      // record may be a plan's shared record, and the read that says otherwise may have failed.
      const calls = bundleCalls(childName, parsed.bundle, { agent, unlink: true });
      const r = await tx.run(() =>
        mutateAsync({ address: my.resolver!, abi: PermissionedResolverImplAbi, functionName: "multicall", args: [calls], chainId: CHAIN_ID }),
      );
      if (!r) return;
    }
    setPendingKey(null);
    await refresh();
    onStarted(childName);
  };

  if (!my.deployed) {
    return (
      <div className="flex flex-col gap-2">
        <Why>Agent limits live on your resolver. Deploy it first.</Why>
        <div>
          <TxButton tx={my.tx} onClick={my.deploy}>
            Deploy my resolver
          </TxButton>
        </div>
        <TxStatus tx={my.tx} showEvents={false} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Row>
        <Field label="Session name">
          <div className="flex items-center gap-1">
            <Input value={labelInput} onChange={(e) => setLabelInput(e.target.value)} placeholder="laptop" className="w-32" />
            <span className="font-mono text-sm">.{parent.name}</span>
          </div>
        </Field>
        {label && s && (
          <Badge tone={checking ? "neutral" : registered && !resumable ? "danger" : registered ? "info" : "success"}>
            {checking ? "checking…" : registered && !resumable ? "taken" : registered ? "half done" : "free"}
          </Badge>
        )}
        <Field label="Ends after">
          <Select value={duration} onChange={(e) => setDuration(e.target.value)}>
            {SESSION_DURATIONS.map((d) => (
              <option key={d.seconds} value={d.seconds}>
                {d.label}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </Select>
        </Field>
        {duration === "custom" && (
          <Field label="Minutes">
            <Input value={customMinutes} onChange={(e) => setCustomMinutes(e.target.value)} inputMode="numeric" className="w-24" />
          </Field>
        )}
      </Row>

      {resumable ? (
        <Why>
          This session was registered to <AddressLink address={resumeKey} short /> but its limits were never written. Finish it below.
        </Why>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          <span className="font-medium">Agent key</span>
          <label className="flex items-start gap-2">
            <input type="radio" checked={keyMode === "generate"} onChange={() => setKeyMode("generate")} className="mt-1" />
            <span>
              Generate a demo key in this browser <span className="text-zinc-500">({DEMO_KEY_WARNING})</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" checked={keyMode === "paste"} onChange={() => setKeyMode("paste")} className="mt-1" />
            <span>Use the agent&apos;s own key (paste its address; the agent signs its own tokens)</span>
          </label>
          {keyMode === "paste" && (
            <div className="flex flex-col gap-2">
              <Input value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="0x… agent address" className="max-w-md" />
              {pastedIsContract && <Why>{CONTRACT_OWNER_WARNING}</Why>}
              <CodeBlock label="On the agent's machine, first (prints the address to paste here)" text={AGENT_CLI.newKey} />
              <CodeBlock
                label="Then, once the session has started (sets up Claude Code and Codex to go through the relay)"
                text={AGENT_CLI.env(childName ?? `<name>.${parent.name}`, status.data?.baseUrl)}
              />
            </div>
          )}
        </div>
      )}

      <BundleEditor value={value} onChange={setDraft} above={above} />

      {childName && (registered || tx.state.status !== "idle") && !oneTx && (
        <Checklist>
          <Check n={1} done={registered} title={`Register ${childName} to the agent key`} />
          <Check n={2} done={!!childBundle.data?.bundle} active={registered} title="Write its limits and address" />
        </Checklist>
      )}
      <ErrorText>{problem}</ErrorText>
      <div>
        <TxButton tx={tx} onClick={start} disabled={!!problem || !label || checking}>
          {resumable ? "Finish the session" : `Start ${childName ?? "session"}`}
        </TxButton>
      </div>
      <Why>
        {oneTx
          ? "One wallet confirmation (Session Minter is enabled for your names)."
          : "Two wallet confirmations: register the name, then write its limits. Enable the Session Minter below to make it one."}
      </Why>
      <TxStatus tx={tx} showEvents={false} />
    </div>
  );
}

/** Under "More tools": the older flow, an agent whose key is kept in this browser. */
export function StartSessionCard({ myNode, onStarted }: { myNode: RelayNode | null; onStarted: (ref: RelayNodeRef) => void }) {
  return (
    <Card
      title="Browser agent session"
      description="For testing: an agent name whose key is kept in this browser. In the demo, ./relay creates agents on the user's laptop."
    >
      {!myNode?.subregistry ? (
        <Why>Select a level you own in the team tree.</Why>
      ) : !myNode.canAddBelow ? (
        <Why>This wallet can&apos;t add names under {myNode.name}.</Why>
      ) : (
        <StartSession key={myNode.name} parent={myNode} onStarted={(name) => onStarted({ name, registry: myNode.subregistry! })} />
      )}
    </Card>
  );
}
