"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { type Address, isAddress, isAddressEqual, zeroAddress } from "viem";
import { useBytecode, usePublicClient, useReadContract, useWriteContract } from "wagmi";

import { TxButton, TxStatus } from "@/components/Tx";
import { AddressLink, Badge, Button, ErrorText, Field, Input, Notice, Row, Select } from "@/components/ui";
import { PermissionedResolverImplAbi } from "@/lib/ens/abis/PermissionedResolverImpl";
import { UserRegistryImplAbi } from "@/lib/ens/abis/UserRegistryImpl";
import { explorerTx } from "@/lib/ens/contracts";
import { dnsEncode, labelId, namehash, tryNormalize } from "@/lib/ens/names";
import { RegistryRoles } from "@/lib/ens/roles";
import { useLocalJson } from "@/lib/hooks/useLocalJson";
import { useMyResolver } from "@/lib/hooks/useMyResolver";
import { useRelayRefresh } from "@/lib/hooks/useRelayApi";
import { useRelayLevels } from "@/lib/hooks/useRelayLevels";
import type { RelayNode } from "@/lib/hooks/useRelayNode";
import { useTx } from "@/lib/hooks/useTx";
import {
  type BundleDraft,
  CONTRACT_OWNER_WARNING,
  MEMBER_DURATIONS,
  bundleCalls,
  bundleFromDraft,
  chainNow,
  draftFromBundle,
  emptyBundle,
  errorText,
  plansStorageKey,
  readBundle,
  relayApi,
} from "@/lib/relay/browser";
import type { FundResponse } from "@/lib/relay/types";
import { CHAIN_ID } from "@/lib/wagmi";

import { BundleEditor } from "./BundleEditor";
import { Check, Checklist, Why } from "./Checklist";

const NO_PLANS: string[] = [];

type Fund = { status: "sending" } | { status: "done"; result: FundResponse } | { status: "error"; message: string };

/**
 * Registers a member under `parent` (with the right to add names below),
 * writes their limits, then asks the relay's funder to send them a little
 * Sepolia ETH for gas.
 */
export function AddMember({ parent, onAdded }: { parent: RelayNode; onAdded: (name: string) => void }) {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const { mutateAsync } = useWriteContract();
  const my = useMyResolver();
  const refresh = useRelayRefresh();
  const tx = useTx();
  const chain = useRelayLevels(parent.name);

  const [labelInput, setLabelInput] = useState("");
  const [ownerInput, setOwnerInput] = useState("");
  const [duration, setDuration] = useState<string>(String(MEMBER_DURATIONS[0].seconds));
  const [customDays, setCustomDays] = useState("7");
  const [plan, setPlan] = useState("");
  const [draft, setDraft] = useState<BundleDraft | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [fund, setFund] = useState<Fund | null>(null);

  const [plans] = useLocalJson<string[]>(my.resolver ? plansStorageKey(my.resolver) : null, NO_PLANS);
  const myPlans = plans.filter((p) => p.endsWith(`.${parent.name}`));

  const normalized = tryNormalize(labelInput);
  const label = normalized && !normalized.includes(".") ? normalized : null;
  const childName = label ? `${label}.${parent.name}` : null;
  const owner = isAddress(ownerInput) ? (ownerInput as Address) : null;
  const seconds = duration === "custom" ? Math.round(Number(customDays) * 86400) : Number(duration);

  // A new member starts with nothing ticked: the admin picks what they get.
  const value = draft ?? draftFromBundle(emptyBundle("month"));
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
  const planRecord = useReadContract({
    address: my.resolver,
    abi: PermissionedResolverImplAbi,
    functionName: "getRecordId",
    args: [namehash(plan || "0")],
    chainId: CHAIN_ID,
    query: { enabled: my.deployed && !!plan },
  });

  const ownerCode = useBytecode({ address: owner ?? undefined, chainId: CHAIN_ID, query: { enabled: !!owner } });
  const ownerIsContract = !!ownerCode.data && ownerCode.data !== "0x";

  const s = state.data;
  const registered = s?.status === 2;
  const takenByOther = registered && (!owner || !isAddressEqual(s.latestOwner, owner));
  const hasBundle = !!childBundle.data?.bundle;
  const planMissing = !!plan && planRecord.data === 0n;

  const problem = !label
    ? labelInput && "Use one simple label, like \"derek\"."
    : !owner
      ? ownerInput && "That isn't a wallet address."
      : !(seconds > 0)
        ? "Pick how long."
        : takenByOther
          ? `${childName} is already taken.`
          : !plan && parsed.error
            ? parsed.error
            : planMissing
              ? "That plan has no limits written yet (save it in Plans first)."
              : null;

  const register = async () => {
    const expiry = BigInt((await chainNow(client!)) + seconds);
    return tx.run(() =>
      mutateAsync({
        address: parent.subregistry!,
        abi: UserRegistryImplAbi,
        functionName: "register",
        // Members get ROLE_SET_SUBREGISTRY on their own name, so they can hang their agents under it.
        args: [label!, owner!, zeroAddress, my.resolver!, RegistryRoles.ROLE_SET_SUBREGISTRY, expiry],
        chainId: CHAIN_ID,
      }),
    );
  };

  // Plans share one record through linkToNode; otherwise the member gets its own bundle.
  const writeLimits = () =>
    tx.run(() =>
      plan
        ? mutateAsync({
            address: my.resolver!,
            abi: PermissionedResolverImplAbi,
            functionName: "linkToNode",
            args: [dnsEncode(childName!), namehash(plan)],
            chainId: CHAIN_ID,
          })
        : mutateAsync({
            address: my.resolver!,
            abi: PermissionedResolverImplAbi,
            functionName: "multicall",
            // Records outlive a removed name. Always detach first (you hold ROLE_LINK on your own
            // resolver), so these writes can't edit a plan an earlier holder was on, whatever the read said.
            args: [bundleCalls(childName!, parsed.bundle!, { unlink: true })],
            chainId: CHAIN_ID,
          }),
    );

  // The relay checks on-chain that the name is registered and owned by the address it pays.
  const topUp = async (name: string) => {
    setFund({ status: "sending" });
    try {
      setFund({ status: "done", result: await relayApi.fund(name) });
    } catch (e) {
      setFund({ status: "error", message: errorText(e as Error) });
    }
  };

  // Always writes the limits chosen here: a re-used label may still carry an old bundle.
  const add = async () => {
    const name = childName!;
    setAdded(null);
    setFund(null);
    if (!registered && !(await register())) return;
    await state.refetch();
    if (!(await writeLimits())) return;
    setAdded(name);
    onAdded(name);
    await Promise.all([refresh(), topUp(name)]);
  };

  const reset = () => {
    setLabelInput("");
    setOwnerInput("");
    setDraft(null);
    setPlan("");
    setAdded(null);
    setFund(null);
    tx.reset();
  };

  if (!my.deployed) {
    return (
      <div className="flex flex-col gap-2">
        <Why>New names keep their limits on your resolver. Deploy it first.</Why>
        <div>
          <TxButton tx={my.tx} onClick={my.deploy}>
            Deploy my resolver
          </TxButton>
        </div>
        <TxStatus tx={my.tx} showEvents={false} />
      </div>
    );
  }

  if (added) {
    return (
      <div className="flex flex-col gap-3">
        <Notice tone="success" title={`Added ${added}`}>
          <p>They can now create their agents under it. The live view above is watching them.</p>
          <FundResult fund={fund} />
        </Notice>
        <div>
          <Button variant="secondary" onClick={reset}>
            Add another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Row>
        <Field label="Name">
          <div className="flex items-center gap-1">
            <Input value={labelInput} onChange={(e) => setLabelInput(e.target.value)} placeholder="derek" className="w-32" />
            <span className="font-mono text-sm">.{parent.name}</span>
          </div>
        </Field>
        {label && s && <Badge tone={takenByOther ? "danger" : registered ? "info" : "success"}>{takenByOther ? "taken" : registered ? "registered" : "free"}</Badge>}
      </Row>
      <Row>
        <Field label="Their wallet address" hint="What ./relay init printed">
          <Input value={ownerInput} onChange={(e) => setOwnerInput(e.target.value)} placeholder="0x…" className="w-96" />
        </Field>
        <Field label="For">
          <Select value={duration} onChange={(e) => setDuration(e.target.value)}>
            {MEMBER_DURATIONS.map((d) => (
              <option key={d.seconds} value={d.seconds}>
                {d.label}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </Select>
        </Field>
        {duration === "custom" && (
          <Field label="Days">
            <Input value={customDays} onChange={(e) => setCustomDays(e.target.value)} inputMode="decimal" className="w-24" />
          </Field>
        )}
      </Row>
      {ownerIsContract && !registered && <Why>{CONTRACT_OWNER_WARNING}</Why>}
      {myPlans.length > 0 && (
        <Field label="Limits">
          <Select value={plan} onChange={(e) => setPlan(e.target.value)} className="max-w-md">
            <option value="">Set limits for this person</option>
            {myPlans.map((p) => (
              <option key={p} value={p}>
                Use plan {p.split(".")[0].replace(/^plan-/, "")}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {!plan && <BundleEditor value={value} onChange={setDraft} above={chain.levels ?? (chain.error ? undefined : null)} />}
      {chain.error && <Why>Couldn&apos;t read what the levels above allow ({errorText(chain.error)}). The relay still enforces them.</Why>}

      {childName && owner && (registered || tx.state.status !== "idle") && (
        <Checklist>
          <Check n={1} done={registered && !takenByOther} title={`Register ${childName}`}>
            {registered && <AddressLink address={s?.latestOwner} short />}
          </Check>
          <Check n={2} done={hasBundle} active={registered} title={plan ? "Link to the plan" : "Write their limits"} />
        </Checklist>
      )}
      <ErrorText>{problem}</ErrorText>
      <div>
        <TxButton tx={tx} onClick={add} disabled={!!problem || !label || !owner}>
          {registered && !takenByOther ? "Write their limits" : `Add ${childName ?? "member"}`}
        </TxButton>
      </div>
      <Why>Two wallet confirmations: register the name, then write its limits. Then the relay sends them a little Sepolia ETH for gas.</Why>
      <TxStatus tx={tx} showEvents={false} />
    </div>
  );
}

function FundResult({ fund }: { fund: Fund | null }) {
  if (!fund) return null;
  if (fund.status === "sending") return <p className="mt-1">Sending them Sepolia ETH for gas…</p>;
  if (fund.status === "error") return <p className="mt-1">No Sepolia ETH sent: {fund.message}</p>;
  const r = fund.result;
  if (!r.funded) return <p className="mt-1">No Sepolia ETH sent: {r.reason}</p>;
  return (
    <p className="mt-1">
      Sent {r.amountEth} Sepolia ETH to <span className="font-mono">{r.address}</span>{" "}
      <a href={explorerTx(r.txHash)} target="_blank" rel="noreferrer" className="underline">
        (tx)
      </a>
    </p>
  );
}
