"use client";

import { useState } from "react";
import { type Address, encodeFunctionData, isAddress, isAddressEqual } from "viem";
import { useConnection, useReadContract, useWriteContract } from "wagmi";

import { TxButton, TxStatus } from "@/components/Tx";
import { Badge, Card, Field, Input, Notice, Row, Select } from "@/components/ui";
import { PermissionedResolverImplAbi } from "@/lib/ens/abis/PermissionedResolverImpl";
import { textKeyResource } from "@/lib/ens/access";
import { ResolverRoles } from "@/lib/ens/roles";
import { useMyResolver } from "@/lib/hooks/useMyResolver";
import { useRelayRefresh } from "@/lib/hooks/useRelayApi";
import type { RelayNode } from "@/lib/hooks/useRelayNode";
import { useTx } from "@/lib/hooks/useTx";
import { PROVIDERS, RECORD_KEYS } from "@/lib/relay/bundle";
import { CHAIN_ID } from "@/lib/wagmi";

import { Why } from "./Checklist";

const METERED = PROVIDERS.filter((p) => p.metered);

/**
 * Per-key delegation on the wallet's resolver: the delegate may change one
 * cap record and nothing else. grantRoles is disabled on PermissionedResolver;
 * grantSetterRoles derives the key's resource from an encoded setter call.
 * The grant covers that key on every name the resolver serves: the names you
 * added, your plans, and the company's own limits if they live there too.
 */
export function Delegates({ myNode, companyResolver }: { myNode: RelayNode | null; companyResolver: Address | null }) {
  const { address } = useConnection();
  const { mutateAsync } = useWriteContract();
  const my = useMyResolver();
  const refresh = useRelayRefresh();
  const tx = useTx();
  const [who, setWho] = useState("");
  const [provider, setProvider] = useState<string>(METERED[0].id);

  const account = isAddress(who) ? (who as Address) : null;
  const coversCompany = !!companyResolver && !!my.resolver && isAddressEqual(companyResolver, my.resolver);
  const key = RECORD_KEYS.cap(provider);
  const resource = textKeyResource(key);

  const roles = useReadContract({
    address: my.resolver,
    abi: PermissionedResolverImplAbi,
    functionName: "roles",
    args: [resource, account!],
    chainId: CHAIN_ID,
    query: { enabled: my.deployed && !!account },
  });
  const has = roles.data !== undefined ? (roles.data & ResolverRoles.ROLE_SET_TEXT) !== 0n : undefined;

  const grant = async () => {
    if (!my.resolver || !account) return;
    // Only the selector and the key matter; name and value are placeholders.
    const setter = encodeFunctionData({ abi: PermissionedResolverImplAbi, functionName: "setText", args: ["0x00", key, ""] });
    const r = await tx.run(() =>
      mutateAsync({ address: my.resolver!, abi: PermissionedResolverImplAbi, functionName: "grantSetterRoles", args: [setter, account], chainId: CHAIN_ID }),
    );
    if (r) await refresh();
  };

  const revoke = async () => {
    if (!my.resolver || !account) return;
    const r = await tx.run(() =>
      mutateAsync({
        address: my.resolver!,
        abi: PermissionedResolverImplAbi,
        functionName: "revokeRoles",
        args: [resource, ResolverRoles.ROLE_SET_TEXT, account],
        chainId: CHAIN_ID,
      }),
    );
    if (r) await refresh();
  };

  return (
    <Card title="Delegates" description="Let someone (say, finance) change one spending cap without being able to change anything else.">
      {!address ? (
        <Why>Connect a wallet.</Why>
      ) : !myNode ? (
        <Why>
          For a name you own with people under it: select it in the team tree. If someone gave you a cap to manage, select that name
          in the team tree and use &quot;Change a cap&quot;.
        </Why>
      ) : !my.deployed ? (
        <div className="flex flex-col gap-2">
          <Why>The limits of names under {myNode.name} live on your resolver. Deploy it first.</Why>
          <div>
            <TxButton tx={my.tx} onClick={my.deploy}>
              Deploy my resolver
            </TxButton>
          </div>
          <TxStatus tx={my.tx} showEvents={false} />
        </div>
      ) : (
        <>
          <Notice>
            They can change that cap on every name whose limits live on your resolver: the people and agents you added
            {coversCompany ? ", your plans, and the company-wide limit" : " and your plans"}.
          </Notice>
          <Row>
            <Field label="Their address">
              <Input value={who} onChange={(e) => setWho(e.target.value)} placeholder="0x…" className="w-96" />
            </Field>
            <Field label="May change">
              <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
                {METERED.map((p) => (
                  <option key={p.id} value={p.id}>
                    the {p.label} cap
                  </option>
                ))}
              </Select>
            </Field>
            {account && has !== undefined && <Badge tone={has ? "success" : "neutral"}>{has ? "can change it now" : "can't change it"}</Badge>}
          </Row>
          <Row>
            <TxButton tx={tx} onClick={grant} disabled={!account || has === true}>
              Allow
            </TxButton>
            <TxButton tx={tx} variant="secondary" onClick={revoke} disabled={!account || has !== true}>
              Take it back
            </TxButton>
          </Row>
          <Why>
            They change it from this page: select the name in the team tree{coversCompany ? " (the company row for the company-wide limit)" : ""}{" "}
            and use &quot;Change a cap&quot;.
          </Why>
          <TxStatus tx={tx} showEvents={false} />
        </>
      )}
    </Card>
  );
}
