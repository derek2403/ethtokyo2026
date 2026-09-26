"use client";

import { useState } from "react";
import { type Address, isAddress, zeroAddress } from "viem";
import { useConnection, useDeployContract, useReadContract, useWriteContract } from "wagmi";

import { TxButton, TxStatus } from "@/components/Tx";
import { AddressLink, Badge, Button, Card, Field, Input, Row } from "@/components/ui";
import { PermissionedResolverImplAbi } from "@/lib/ens/abis/PermissionedResolverImpl";
import { UserRegistryImplAbi } from "@/lib/ens/abis/UserRegistryImpl";
import { RegistryRoles, adminOf } from "@/lib/ens/roles";
import { useMyResolver } from "@/lib/hooks/useMyResolver";
import { useRelayRefresh } from "@/lib/hooks/useRelayApi";
import { MINTER_RESOLVER_ROLES, useRelayMinter } from "@/lib/hooks/useRelayMinter";
import type { RelayNode } from "@/lib/hooks/useRelayNode";
import { useTx } from "@/lib/hooks/useTx";
import { SessionMinterAbi, SessionMinterBytecode } from "@/lib/relay/sessionMinter";
import { CHAIN_ID } from "@/lib/wagmi";

import { Why } from "./Checklist";

/**
 * One shared contract that registers an agent name and writes its records in
 * a single transaction. It checks on every call that the caller already holds
 * the roles it uses, so granting it roles never lets anyone do more.
 */
export function SessionMinterCard({ myNode }: { myNode: RelayNode | null }) {
  const { address } = useConnection();
  const { mutateAsync } = useWriteContract();
  const { mutateAsync: deployContract } = useDeployContract();
  const my = useMyResolver();
  const refresh = useRelayRefresh();
  const tx = useTx();
  const [pasted, setPasted] = useState("");

  const registry = myNode?.subregistry ?? null;
  const resolver = my.deployed ? my.resolver ?? null : null;
  const m = useRelayMinter(registry, resolver);
  const wallet = (address ?? zeroAddress) as Address;

  // Granting a role needs its admin role; the wallet that deployed its registry and resolver has all of them.
  const canGrantRegistry = useReadContract({
    address: registry ?? undefined,
    abi: UserRegistryImplAbi,
    functionName: "hasRootRoles",
    args: [adminOf(RegistryRoles.ROLE_REGISTRAR), wallet],
    chainId: CHAIN_ID,
    query: { enabled: !!registry && !!address },
  });
  const canGrantResolver = useReadContract({
    address: resolver ?? undefined,
    abi: PermissionedResolverImplAbi,
    functionName: "hasRootRoles",
    args: [adminOf(MINTER_RESOLVER_ROLES), wallet],
    chainId: CHAIN_ID,
    query: { enabled: !!resolver && !!address },
  });

  const deploy = async () => {
    const r = await tx.run(() => deployContract({ abi: SessionMinterAbi, bytecode: SessionMinterBytecode, chainId: CHAIN_ID }));
    if (r?.receipt.contractAddress) m.save(r.receipt.contractAddress);
  };

  const setRoles = async (enable: boolean) => {
    if (!m.minter || !registry || !resolver) return;
    const fn = enable ? "grantRootRoles" : "revokeRootRoles";
    if (enable ? !m.onRegistry : m.onRegistry) {
      const r = await tx.run(() =>
        mutateAsync({ address: registry, abi: UserRegistryImplAbi, functionName: fn, args: [RegistryRoles.ROLE_REGISTRAR, m.minter!], chainId: CHAIN_ID }),
      );
      if (!r) return;
    }
    if (enable ? !m.onResolver : m.onResolver) {
      const r = await tx.run(() =>
        mutateAsync({ address: resolver, abi: PermissionedResolverImplAbi, functionName: fn, args: [MINTER_RESOLVER_ROLES, m.minter!], chainId: CHAIN_ID }),
      );
      if (!r) return;
    }
    await m.refetch();
    await refresh();
  };

  const canGrant = canGrantRegistry.data === true && canGrantResolver.data === true;

  return (
    <Card
      title="One-click agent sessions (Session Minter)"
      description="Starting a session normally takes two confirmations (register, then write limits). The Session Minter does both in one. It re-checks your own roles on every call, so it can never do more than you could."
    >
      {!m.minter ? (
        <div className="flex flex-col gap-3">
          <Why>No Session Minter yet. Deploy one (anyone can share it), or paste one someone already deployed.</Why>
          <Row>
            <TxButton tx={tx} onClick={deploy}>
              Deploy Session Minter
            </TxButton>
            <Input value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="0x… existing minter" className="w-96" />
            <Button variant="secondary" disabled={!isAddress(pasted)} onClick={() => m.save(pasted as Address)}>
              Use this one
            </Button>
          </Row>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            Minter: <AddressLink address={m.minter} />
            <Badge tone={m.deployed ? "success" : m.loading ? "neutral" : "danger"}>{m.deployed ? "deployed" : m.loading ? "…" : "no contract here"}</Badge>
            {m.fromEnv ? (
              <span className="text-xs text-zinc-500">from NEXT_PUBLIC_SESSION_MINTER</span>
            ) : (
              <button type="button" onClick={() => m.save(null)} className="text-xs text-zinc-500 hover:underline">
                forget
              </button>
            )}
          </div>
          {!m.fromEnv && (
            <Why>
              To share it with your team, put <span className="font-mono">NEXT_PUBLIC_SESSION_MINTER={m.minter}</span> in .env.local.
            </Why>
          )}

          {!myNode || !registry ? (
            <Why>Enable it for a name you own with people under it: finish company setup, or select such a name in the tree.</Why>
          ) : !resolver ? (
            <Why>Deploy your resolver first.</Why>
          ) : (
            <>
              <Field label={`For names under ${myNode.name} (to change, select another name you own in the team tree)`}>
                <div className="flex flex-wrap gap-2 text-sm">
                  <Badge tone={m.onRegistry ? "success" : "neutral"}>{m.onRegistry ? "✓" : "○"} may register names</Badge>
                  <Badge tone={m.onResolver ? "success" : "neutral"}>{m.onResolver ? "✓" : "○"} may write limits and addresses</Badge>
                </div>
              </Field>
              {!canGrant && (canGrantRegistry.data === false || canGrantResolver.data === false) && (
                <Why>Only the wallet that set up this registry and resolver can enable it.</Why>
              )}
              <Row>
                {!m.ready && (
                  <TxButton tx={tx} onClick={() => setRoles(true)} disabled={!m.deployed || !canGrant}>
                    Enable for my names
                  </TxButton>
                )}
                {(m.onRegistry || m.onResolver) && (
                  <TxButton tx={tx} variant="secondary" onClick={() => setRoles(false)} disabled={!canGrant}>
                    Disable
                  </TxButton>
                )}
              </Row>
              {m.ready && <Why>Enabled: a &quot;Browser agent session&quot; now takes one confirmation.</Why>}
            </>
          )}
        </div>
      )}
      <TxStatus tx={tx} showEvents={false} />
    </Card>
  );
}
