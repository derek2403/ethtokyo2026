"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { Address } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";

import { TxButton, TxStatus } from "@/components/Tx";
import { Button, Card, ErrorText, Field, Input } from "@/components/ui";
import { PermissionedResolverImplAbi } from "@/lib/ens/abis/PermissionedResolverImpl";
import { tryNormalize } from "@/lib/ens/names";
import { useLocalJson } from "@/lib/hooks/useLocalJson";
import { useMyResolver } from "@/lib/hooks/useMyResolver";
import { useRelayRefresh } from "@/lib/hooks/useRelayApi";
import { useRelayLevels } from "@/lib/hooks/useRelayLevels";
import type { RelayNode } from "@/lib/hooks/useRelayNode";
import { useTx } from "@/lib/hooks/useTx";
import {
  type BundleDraft,
  bundleCalls,
  bundleFromDraft,
  defaultBundle,
  draftFromBundle,
  planName,
  plansStorageKey,
  readBundle,
} from "@/lib/relay/browser";
import { describeBundle } from "@/lib/relay/bundle";
import { CHAIN_ID } from "@/lib/wagmi";

import { BundleEditor } from "./BundleEditor";
import { Why } from "./Checklist";

const NO_PLANS: string[] = [];

/**
 * A plan is a bundle written once for a placeholder name (plan-<slug>.<you>)
 * on your resolver. Members linked to it share that one record, so editing
 * the plan changes everyone on it at once. Linking happens where a member is
 * managed: "Use a plan" in their panel, or the Limits choice in Add a member.
 */
export function Plans({ myNode }: { myNode: RelayNode | null }) {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const { mutateAsync } = useWriteContract();
  const my = useMyResolver();
  const refresh = useRelayRefresh();
  const tx = useTx();

  const [plans, setPlans] = useLocalJson<string[]>(my.resolver ? plansStorageKey(my.resolver) : null, NO_PLANS);
  const [slugInput, setSlugInput] = useState("");
  const [draft, setDraft] = useState<BundleDraft | null>(null);

  const parent = myNode?.name ?? null;
  // A plan is for names under `parent`, so every level down to `parent` bounds it.
  const chain = useRelayLevels(parent);
  const above = chain.levels ?? (chain.error ? undefined : null);
  const myPlans = parent ? plans.filter((p) => p.endsWith(`.${parent}`)) : [];
  const slug = tryNormalize(slugInput);
  const validSlug = !!slug && /^[a-z0-9-]+$/.test(slug);
  const target = parent && validSlug ? planName(slug, parent) : null;

  const existing = useQuery({
    queryKey: ["relay-bundle", my.resolver, target],
    queryFn: () => readBundle(client!, my.resolver!, target!),
    enabled: !!client && my.deployed && !!target,
  });
  const value = draft ?? draftFromBundle(existing.data?.bundle ?? defaultBundle(myNode?.bundle?.bundle ?? null, "month", above ?? undefined));
  const parsed = bundleFromDraft(value);

  if (!myNode || !parent) {
    return (
      <Card title="Plans">
        <Why>Plans are for names you own with people under them. Finish company setup, or select such a name in the tree.</Why>
      </Card>
    );
  }

  const savePlan = async () => {
    if (!target || !parsed.bundle || !my.resolver) return;
    const r = await tx.run(() =>
      mutateAsync({
        address: my.resolver!,
        abi: PermissionedResolverImplAbi,
        functionName: "multicall",
        args: [bundleCalls(target, parsed.bundle!, { plan: target })],
        chainId: CHAIN_ID,
      }),
    );
    if (r) {
      if (!plans.includes(target)) setPlans([...plans, target]);
      setDraft(null);
      await refresh();
    }
  };

  return (
    <Card
      title={`Plans for people under ${parent}`}
      description={`Reusable limits: change a plan once and everyone on it follows. To put someone on a plan, select them in the team tree and use "Use a plan". For plans under another name you own, select that name in the tree.`}
    >
      {!my.deployed ? (
        <div className="flex flex-col gap-2">
          <Why>Plans live on your resolver. Deploy it first.</Why>
          <div>
            <TxButton tx={my.tx} onClick={my.deploy}>
              Deploy my resolver
            </TxButton>
          </div>
          <TxStatus tx={my.tx} showEvents={false} />
        </div>
      ) : (
        <>
          {myPlans.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {myPlans.map((p) => (
                <PlanRow
                  key={p}
                  plan={p}
                  resolver={my.resolver!}
                  onEdit={() => {
                    setSlugInput(p.split(".")[0].replace(/^plan-/, ""));
                    setDraft(null);
                  }}
                />
              ))}
            </ul>
          )}

          <div className="flex flex-col gap-3 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
            <Field label="Plan name" hint={target ? `Stored as ${target}` : "Letters, numbers and dashes"}>
              <Input
                value={slugInput}
                onChange={(e) => {
                  setSlugInput(e.target.value);
                  setDraft(null);
                }}
                placeholder="standard"
                className="w-48"
              />
            </Field>
            <BundleEditor value={value} onChange={setDraft} above={above} />
            <ErrorText>{slugInput && !validSlug ? "Use letters, numbers and dashes." : parsed.error}</ErrorText>
            <div>
              <TxButton tx={tx} onClick={savePlan} disabled={!target || !parsed.bundle}>
                {existing.data?.bundle ? "Update plan" : "Create plan"}
              </TxButton>
            </div>
          </div>

          <TxStatus tx={tx} showEvents={false} />
        </>
      )}
    </Card>
  );
}

function PlanRow({ plan, resolver, onEdit }: { plan: string; resolver: Address; onEdit: () => void }) {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const read = useQuery({
    queryKey: ["relay-bundle", resolver, plan],
    queryFn: () => readBundle(client!, resolver, plan),
    enabled: !!client,
  });
  return (
    <li className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <span>
        <span className="font-medium">{plan.split(".")[0].replace(/^plan-/, "")}</span>{" "}
        <span className="text-xs text-zinc-500">{read.isLoading ? "…" : describeBundle(read.data?.bundle ?? null)}</span>
      </span>
      <Button variant="secondary" onClick={onEdit}>
        Edit
      </Button>
    </li>
  );
}
