"use client";

import { useState } from "react";
import { isAddressEqual } from "viem";
import { useConnection, useWriteContract } from "wagmi";

import { Faucet } from "@/components/Faucet";
import { RegisterCard } from "@/components/playground/RegisterCard";
import { TxButton, TxStatus } from "@/components/Tx";
import { AddressLink, Button, Card, ErrorText, Notice, Row } from "@/components/ui";
import { ETHRegistryAbi } from "@/lib/ens/abis/ETHRegistry";
import { PermissionedResolverImplAbi } from "@/lib/ens/abis/PermissionedResolverImpl";
import { addresses } from "@/lib/ens/contracts";
import { labelId } from "@/lib/ens/names";
import { useMyResolver } from "@/lib/hooks/useMyResolver";
import { useRelayRefresh } from "@/lib/hooks/useRelayApi";
import { useRelayNode } from "@/lib/hooks/useRelayNode";
import { useRelaySubnameSetup } from "@/lib/hooks/useRelaySetup";
import { useTx } from "@/lib/hooks/useTx";
import { type BundleDraft, bundleCalls, bundleFromDraft, draftFromBundle } from "@/lib/relay/browser";
import { type Bundle, PROVIDERS, describeBundle } from "@/lib/relay/bundle";
import type { StatusResponse } from "@/lib/relay/types";
import { CHAIN_ID } from "@/lib/wagmi";

import { BundleEditor } from "./BundleEditor";
import { Check, Checklist, Why } from "./Checklist";
import { SubnameSetup } from "./SubnameSetup";

/** Starting point for the company bundle: every provider the relay has a key for. */
function companyDefault(status: StatusResponse | undefined): Bundle {
  const keys = PROVIDERS.filter((p) => p.id === "mock" || status?.providers.find((s) => s.id === p.id)?.configured).map((p) => p.id);
  const caps = Object.fromEntries(PROVIDERS.filter((p) => p.metered && keys.includes(p.id)).map((p) => [p.id, p.id === "mock" ? 5 : 100]));
  return { keys, caps, maxes: {}, period: "month" };
}

export function CompanySetup({
  root,
  status,
  onRegistered,
}: {
  root: string | null;
  status: StatusResponse | undefined;
  onRegistered: (name: string) => void;
}) {
  const { isConnected } = useConnection();
  const { mutateAsync } = useWriteContract();
  const node = useRelayNode(root ? { name: root, registry: addresses.ETHRegistry } : null);
  const my = useMyResolver();
  const setup = useRelaySubnameSetup(root, addresses.ETHRegistry);
  const refresh = useRelayRefresh();
  const tx = useTx();
  const [draft, setDraft] = useState<BundleDraft | null>(null);
  const [editing, setEditing] = useState(false);

  const isEth2ld = !!root && /^[^.]+\.eth$/.test(root);
  const owns = node.iOwn;
  const pointed = !!node.resolver && !!my.resolver && my.deployed && isAddressEqual(node.resolver, my.resolver);
  const current = pointed ? node.bundle?.bundle ?? null : null;
  const value = draft ?? draftFromBundle(current ?? companyDefault(status));
  const parsed = bundleFromDraft(value);
  const allDone = owns && my.deployed && pointed && !!current && setup.done;

  const pointAtMyResolver = async () => {
    if (!root || !my.resolver) return;
    const r = await tx.run(() =>
      mutateAsync({
        address: addresses.ETHRegistry,
        abi: ETHRegistryAbi,
        functionName: "setResolver",
        args: [labelId(node.label), my.resolver!],
        chainId: CHAIN_ID,
      }),
    );
    if (r) await refresh();
  };

  const saveBundle = async () => {
    if (!root || !my.resolver || !parsed.bundle) return;
    const r = await tx.run(() =>
      mutateAsync({
        address: my.resolver!,
        abi: PermissionedResolverImplAbi,
        functionName: "multicall",
        args: [bundleCalls(root, parsed.bundle)],
        chainId: CHAIN_ID,
      }),
    );
    if (r) {
      setDraft(null);
      setEditing(false);
      await refresh();
    }
  };

  return (
    <Card
      title="Company setup"
      description="For the owner of the company name. Each tick is read from the chain, so you can stop and come back."
    >
      {!root ? (
        <>
          <Notice>Type your company name in the box above, or register a new .eth name here.</Notice>
          <RegisterRoot onRegistered={onRegistered} />
        </>
      ) : (
        <Checklist>
          <Check n={1} done={owns} title={`Own ${root}`}>
            {!owns &&
              (!isConnected ? (
                <Why>Connect the wallet that owns {root}.</Why>
              ) : node.loading ? (
                <Why>Checking…</Why>
              ) : node.active ? (
                <Why>
                  {root} belongs to <AddressLink address={node.owner} short />. Connect that wallet to set it up.
                </Why>
              ) : node.expired ? (
                <Why>{root} has expired. Renew it on the playground page (/playground).</Why>
              ) : isEth2ld ? (
                <RegisterRoot onRegistered={onRegistered} />
              ) : (
                <Why>{root} isn&apos;t registered. Only .eth names can be registered here.</Why>
              ))}
          </Check>

          <Check n={2} done={my.deployed} active={owns} title="Deploy your resolver (it holds the company's limits)">
            {owns && !my.deployed && !my.loading && (
              <div>
                <TxButton tx={my.tx} onClick={my.deploy}>
                  Deploy my resolver
                </TxButton>
              </div>
            )}
            <TxStatus tx={my.tx} showEvents={false} />
          </Check>

          <Check n={3} done={pointed} active={owns && my.deployed} title={`Point ${root} at your resolver`}>
            {owns && my.deployed && !pointed && (
              <div>
                <TxButton tx={tx} onClick={pointAtMyResolver}>
                  Use my resolver for {root}
                </TxButton>
              </div>
            )}
          </Check>

          <Check
            n={4}
            done={!!current && !editing}
            active={pointed}
            title={current ? `Company limits: ${describeBundle(current)}` : "Write the company limits"}
          >
            {pointed && (current && !editing ? (
              <div>
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  Change
                </Button>
              </div>
            ) : (
              <>
                <Why>Nobody in the company can go beyond these. Leave a cap empty for no cap at this level.</Why>
                <BundleEditor value={value} onChange={setDraft} />
                <ErrorText>{parsed.error}</ErrorText>
                <Row>
                  <TxButton tx={tx} onClick={saveBundle} disabled={!parsed.bundle}>
                    Save company limits
                  </TxButton>
                  {editing && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setEditing(false);
                        setDraft(null);
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </Row>
              </>
            ))}
          </Check>

          <Check n={5} done={setup.done} active={owns} title="Let people be added under the company">
            {owns && !setup.done && <SubnameSetup name={root} parentRegistry={addresses.ETHRegistry} cta="Enable adding people" />}
          </Check>
        </Checklist>
      )}
      <TxStatus tx={tx} showEvents={false} />
      {allDone && <Notice tone="success">The company is set up. Add people and agents in the team tree below.</Notice>}
    </Card>
  );
}

/**
 * The playground's registration card, preceded by the test-USDC faucet it
 * refers to as "step 1" (the fee is paid in MockUSDC, which anyone can mint).
 */
function RegisterRoot({ onRegistered }: { onRegistered: (name: string) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Card title="1. Get test USDC" description="Registering a .eth name costs a small fee in test USDC. Anyone can mint it.">
        <Faucet />
      </Card>
      <RegisterCard onRegistered={onRegistered} />
    </div>
  );
}
