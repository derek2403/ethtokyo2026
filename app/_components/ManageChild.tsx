"use client";

import { useState } from "react";
import { usePublicClient, useReadContract, useWriteContract } from "wagmi";

import { TxButton, TxStatus } from "@/components/Tx";
import { Button, ErrorText, Input, Notice, Row, Select } from "@/components/ui";
import { PermissionedResolverImplAbi } from "@/lib/ens/abis/PermissionedResolverImpl";
import { UserRegistryImplAbi } from "@/lib/ens/abis/UserRegistryImpl";
import { dnsEncode, labelId, namehash } from "@/lib/ens/names";
import { useLocalJson } from "@/lib/hooks/useLocalJson";
import { useRelayRefresh } from "@/lib/hooks/useRelayApi";
import { useRelayLevels } from "@/lib/hooks/useRelayLevels";
import type { RelayNode } from "@/lib/hooks/useRelayNode";
import { useTx } from "@/lib/hooks/useTx";
import {
  type BundleDraft,
  EXTEND_BY,
  bundleCalls,
  bundleFromDraft,
  chainNow,
  defaultBundle,
  draftFromBundle,
  formatDate,
  isNever,
  nowSec,
  plansStorageKey,
  providerLabel,
} from "@/lib/relay/browser";
import { RECORD_KEYS } from "@/lib/relay/bundle";
import { CHAIN_ID } from "@/lib/wagmi";

import { BundleEditor } from "./BundleEditor";
import { Why } from "./Checklist";

const NO_PLANS: string[] = [];

/** Actions for the level above a name: edit limits, use a plan, extend, remove. */
export function ManageChild({ node }: { node: RelayNode }) {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const { mutateAsync } = useWriteContract();
  const refresh = useRelayRefresh();
  const tx = useTx();
  const chain = useRelayLevels(node.name);

  const [draft, setDraft] = useState<BundleDraft | null>(null);
  const [extendBy, setExtendBy] = useState<string>(String(EXTEND_BY[0].seconds));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [plan, setPlan] = useState("");
  const [capInputs, setCapInputs] = useState<Record<string, string>>({});

  const [plans] = useLocalJson<string[]>(node.resolver ? plansStorageKey(node.resolver) : null, NO_PLANS);
  const myPlans = plans.filter((p) => p.endsWith(`.${node.parent}`));
  const planRecord = useReadContract({
    address: node.resolver ?? undefined,
    abi: PermissionedResolverImplAbi,
    functionName: "getRecordId",
    args: [namehash(plan || "0")],
    chainId: CHAIN_ID,
    query: { enabled: !!node.resolver && !!plan },
  });

  const current = node.bundle?.bundle ?? null;
  const linkedPlan = node.bundle?.plan ?? null;
  // Every level above this name, company first: the editor won't offer more than they allow.
  const above = chain.levels ? chain.levels.slice(0, -1) : chain.error ? undefined : null;
  const parentBundle = above?.[above.length - 1]?.bundle ?? null;
  const value = draft ?? draftFromBundle(current ?? defaultBundle(parentBundle, node.kind === "agent" ? "total" : "month", above ?? undefined));
  const parsed = bundleFromDraft(value);
  const newExpiry = Math.max(nowSec(), node.expiry ?? 0) + Number(extendBy);
  // Writes must not depend on a read that may still be loading or have failed, but the form
  // should show the real current limits (and whether a plan is shared) before anyone saves.
  const readError = node.bundleError ?? node.kindError;
  const reading = !readError && (node.bundleLoading || node.kind === null);
  const readOk = !readError && !reading;
  // Detaching needs ROLE_LINK, and for an agent ROLE_SET_ADDRESS to write its address into the
  // fresh record. Without them, saving on a name that shares a plan's record would edit the plan.
  const canDetach = node.canLink && (node.kind !== "agent" || node.canSetAddress);
  const stuckOnPlan = !canDetach && (!readOk || !!linkedPlan);
  const done = async (r: unknown) => {
    if (r) await refresh();
    return r;
  };

  const saveLimits = async () => {
    if (!node.resolver || !node.name || !parsed.bundle || !readOk || stuckOnPlan) return;
    const calls = bundleCalls(node.name, parsed.bundle, {
      // Always detach first (whatever the read said): if the name shares a plan's record,
      // setText would otherwise change the limits of everyone on the plan.
      unlink: canDetach,
      // Detaching starts a fresh record, so an agent's address is written again.
      agent: canDetach && node.kind === "agent" && node.owner ? node.owner : undefined,
    });
    const r = await tx.run(() =>
      mutateAsync({ address: node.resolver!, abi: PermissionedResolverImplAbi, functionName: "multicall", args: [calls], chainId: CHAIN_ID }),
    );
    if (await done(r)) setDraft(null);
  };

  const saveCap = async (provider: string) => {
    if (!node.resolver || !node.name) return;
    const v = (capInputs[provider] ?? "").trim();
    const r = await tx.run(() =>
      mutateAsync({
        address: node.resolver!,
        abi: PermissionedResolverImplAbi,
        functionName: "setText",
        args: [dnsEncode(node.name!), RECORD_KEYS.cap(provider), v],
        chainId: CHAIN_ID,
      }),
    );
    await done(r);
  };

  const applyPlan = async () => {
    if (!node.resolver || !node.name || !plan) return;
    const r = await tx.run(() =>
      mutateAsync({
        address: node.resolver!,
        abi: PermissionedResolverImplAbi,
        functionName: "linkToNode",
        args: [dnsEncode(node.name!), namehash(plan)],
        chainId: CHAIN_ID,
      }),
    );
    await done(r);
  };

  const extend = async () => {
    if (!node.registry || !client) return;
    const expiry = Math.max(await chainNow(client), node.expiry ?? 0) + Number(extendBy);
    const r = await tx.run(() =>
      mutateAsync({
        address: node.registry!,
        abi: UserRegistryImplAbi,
        functionName: "renew",
        args: [labelId(node.label), BigInt(expiry)],
        chainId: CHAIN_ID,
      }),
    );
    await done(r);
  };

  const remove = async () => {
    if (!node.registry) return;
    const r = await tx.run(() =>
      mutateAsync({ address: node.registry!, abi: UserRegistryImplAbi, functionName: "unregister", args: [labelId(node.label)], chainId: CHAIN_ID }),
    );
    setConfirmRemove(false);
    await done(r);
  };

  const capValid = (v: string) => v.trim() === "" || (Number.isFinite(Number(v)) && Number(v) >= 0);

  const readNotice = readError ? (
    <Notice tone="warning">
      Couldn&apos;t read the current limits of {node.name}, so saving is turned off. Press Refresh in the team tree to try again.
    </Notice>
  ) : reading ? (
    <Why>Reading the current limits…</Why>
  ) : null;

  return (
    <div className="flex flex-col gap-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      {node.canWriteBundle && node.active && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Edit limits</h3>
          {readNotice}
          {linkedPlan && (
            <Notice>
              {node.name} uses plan <span className="font-mono">{linkedPlan}</span>.{" "}
              {canDetach ? "Saving here gives it its own limits instead." : "This wallet can't take it off the plan, so saving here is turned off."}
            </Notice>
          )}
          <BundleEditor value={value} onChange={setDraft} above={above} />
          <ErrorText>{parsed.error}</ErrorText>
          <div>
            <TxButton tx={tx} onClick={saveLimits} disabled={!parsed.bundle || !readOk || stuckOnPlan}>
              Save limits
            </TxButton>
          </div>
        </section>
      )}

      {!node.canWriteBundle && node.delegatedCaps.length > 0 && node.active && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Change a cap (delegated to you)</h3>
          {readNotice}
          {node.isRoot && <Why>This is the company-wide cap: nobody under {node.name} can spend more.</Why>}
          {linkedPlan && <Why>This name uses plan {linkedPlan}: the change applies to everyone on that plan.</Why>}
          {node.delegatedCaps.map((p) => {
            const v = capInputs[p] ?? (current?.caps[p] !== undefined ? String(current.caps[p]) : "");
            return (
              <Row key={p}>
                <span className="w-40 text-sm">{providerLabel(p)} cap $</span>
                <Input value={v} onChange={(e) => setCapInputs({ ...capInputs, [p]: e.target.value })} placeholder="no cap" className="w-28" />
                <TxButton tx={tx} onClick={() => saveCap(p)} disabled={!capValid(v) || capInputs[p] === undefined || !readOk}>
                  Save
                </TxButton>
              </Row>
            );
          })}
        </section>
      )}

      {node.kind === "member" && node.canLink && node.active && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Use a plan</h3>
          {myPlans.length === 0 ? (
            <Why>No plans yet for names under {node.parent}. Create one in Plans below.</Why>
          ) : (
            <Row>
              <Select value={plan} onChange={(e) => setPlan(e.target.value)} className="max-w-xs">
                <option value="">Pick a plan</option>
                {myPlans.map((p) => (
                  <option key={p} value={p}>
                    {p.split(".")[0].replace(/^plan-/, "")}
                  </option>
                ))}
              </Select>
              <TxButton tx={tx} onClick={applyPlan} disabled={!plan || planRecord.data === 0n || plan === linkedPlan}>
                Use this plan
              </TxButton>
            </Row>
          )}
          {plan && planRecord.data === 0n && <Why>That plan has no limits written yet.</Why>}
        </section>
      )}

      {node.canRenew && (node.active || node.expired) && !isNever(node.expiry ?? 0) && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{node.expired ? "Bring back" : "Extend"}</h3>
          <Row>
            <Select value={extendBy} onChange={(e) => setExtendBy(e.target.value)} className="w-auto!">
              {EXTEND_BY.map((d) => (
                <option key={d.seconds} value={d.seconds}>
                  {d.label}
                </option>
              ))}
            </Select>
            <TxButton tx={tx} variant="secondary" onClick={extend}>
              Extend to {formatDate(newExpiry)}
            </TxButton>
          </Row>
        </section>
      )}

      {node.canRemove && node.active && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Remove</h3>
          {!confirmRemove ? (
            <div>
              <Button variant="danger" onClick={() => setConfirmRemove(true)}>
                Remove {node.name}
              </Button>
            </div>
          ) : (
            <Notice tone="danger" title={`Remove ${node.name}?`}>
              <p className="mb-3">It stops working right away, and so does every name and agent under it.</p>
              <Row>
                <TxButton tx={tx} variant="danger" onClick={remove}>
                  Yes, remove it
                </TxButton>
                <Button variant="secondary" onClick={() => setConfirmRemove(false)}>
                  Cancel
                </Button>
              </Row>
            </Notice>
          )}
        </section>
      )}

      <TxStatus tx={tx} showEvents={false} />
    </div>
  );
}
