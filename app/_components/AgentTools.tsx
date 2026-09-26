"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { createWalletClient, formatEther, http, isAddressEqual, parseAbi, parseEther } from "viem";
import { sepolia } from "viem/chains";
import { useBalance, useEnsAddress, useEnsName, usePublicClient, useReadContract, useSendTransaction } from "wagmi";

import { TxButton, TxStatus } from "@/components/Tx";
import { AddressLink, Button, ErrorText, Notice, Row } from "@/components/ui";
import { ReverseRegistrarAdapterAbi } from "@/lib/ens/abis/ReverseRegistrarAdapter";
import { addresses } from "@/lib/ens/contracts";
import { formatError } from "@/lib/ens/errors";
import { useNow } from "@/lib/hooks/useNow";
import { useRelayAgentKeys } from "@/lib/hooks/useRelayAgents";
import { useRelayStatus } from "@/lib/hooks/useRelayApi";
import type { RelayNode } from "@/lib/hooks/useRelayNode";
import { useTx } from "@/lib/hooks/useTx";
import { type StoredAgentKey, agentAccount, agentToken, formatDate, formatDuration, nowSec, tokenSnippets } from "@/lib/relay/browser";
import { DEFAULT_MAX_TOKEN_TTL_SEC, parseToken } from "@/lib/relay/token";
import { CHAIN_ID, RPC_URL } from "@/lib/wagmi";

import { CodeBlock, CopyButton, Why } from "./Checklist";

// Primary names stay on ENSv1 at launch: the agent key calls setName on the
// v1 ReverseRegistrar that the v2 ReverseRegistrarAdapter points to.
const reverseRegistrarAbi = parseAbi(["function setName(string name) returns (bytes32)"]);

/**
 * For an agent whose key lives in this browser: its access token, primary name,
 * and a way to delete the key. Rendered with key={expiry}, so "Extend" drops an old token.
 */
export function AgentTools({ node, agentKey }: { node: RelayNode; agentKey: StoredAgentKey }) {
  const status = useRelayStatus();
  const agents = useRelayAgentKeys();
  const now = useNow();
  const [token, setToken] = useState<{ value: string; exp: number } | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [confirmForget, setConfirmForget] = useState(false);
  const baseUrl = status.data?.baseUrl ?? (typeof window !== "undefined" ? `${window.location.origin}/api/relay` : "/api/relay");
  const ended = !node.active || !node.expiry || node.expiry <= (now || nowSec());
  const maxTtl = status.data?.maxTokenTtlSec ?? DEFAULT_MAX_TOKEN_TTL_SEC;
  const tokenExpired = !!token && token.exp <= (now || nowSec());

  const makeToken = async () => {
    setTokenError(null);
    try {
      const value = await agentToken(agentKey, node.name!, node.expiry!, maxTtl);
      setToken({ value, exp: parseToken(value).payload.exp });
    } catch (e) {
      setTokenError(formatError(e));
    }
  };

  return (
    <div className="flex flex-col gap-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Access token</h3>
        <Why>
          Use it wherever a tool asks for an API key. It is signed by the agent key, stops working when {node.name} ends
          {node.expiry ? ` (${formatDate(node.expiry)})` : ""} or is removed, lasts at most {maxTtl % 3600 === 0 ? `${maxTtl / 3600} hours` : formatDuration(maxTtl)}, and never
          contains a provider key.
        </Why>
        {!token || ended || tokenExpired ? (
          <div>
            <Button onClick={() => void makeToken()} disabled={ended}>
              {tokenExpired && !ended ? "Show a new access token" : "Show access token"}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-zinc-100 px-2 py-1 font-mono text-xs dark:bg-zinc-800">{token.value}</code>
              <CopyButton text={token.value} label="Copy token" />
            </div>
            <Why>Valid until {formatDate(token.exp)}.</Why>
            {tokenSnippets(baseUrl, token.value).map((s) => (
              <CodeBlock key={s.label} label={s.label} text={s.text} />
            ))}
          </>
        )}
        {ended && <Why>This session has ended; extend it to get a new token.</Why>}
        <ErrorText>{tokenError}</ErrorText>
      </section>
      <PrimaryName node={node} agentKey={agentKey} />
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Demo key</h3>
        <Why>
          The agent&apos;s private key is stored unencrypted in this browser, for testing only. Real agents should keep their own
          key (npm run agent -- new).
        </Why>
        {!confirmForget ? (
          <div>
            <Button variant="secondary" onClick={() => setConfirmForget(true)}>
              Forget key
            </Button>
          </div>
        ) : (
          <Notice tone="warning" title="Delete the agent key from this browser?">
            <p className="mb-3">
              Nobody can make new tokens for {node.name} after this; tokens already copied keep working until they expire. To cut it
              off now, remove {node.name} as well.
            </p>
            <Row>
              <Button variant="danger" onClick={() => agents.remove(agentKey.address)}>
                Yes, forget it
              </Button>
              <Button variant="secondary" onClick={() => setConfirmForget(false)}>
                Cancel
              </Button>
            </Row>
          </Notice>
        )}
      </section>
    </div>
  );
}

function PrimaryName({ node, agentKey }: { node: RelayNode; agentKey: StoredAgentKey }) {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const { mutateAsync: send } = useSendTransaction();
  const fundTx = useTx();
  const nameTx = useTx();
  const agent = agentKey.address;
  const name = node.name!;

  const reverseRegistrar = useReadContract({
    address: addresses.ReverseRegistrarAdapter,
    abi: ReverseRegistrarAdapterAbi,
    functionName: "REVERSE_REGISTRAR",
    chainId: CHAIN_ID,
  });
  const forward = useEnsAddress({ name, chainId: CHAIN_ID });
  const current = useEnsName({ address: agent, chainId: CHAIN_ID });
  const balance = useBalance({ address: agent, chainId: CHAIN_ID });
  const pointsBack = !!forward.data && isAddressEqual(forward.data, agent);

  // What setName costs the agent key right now, with headroom for fee changes.
  const needed = useQuery({
    queryKey: ["agent-gas", agent, name, reverseRegistrar.data],
    enabled: !!client && !!reverseRegistrar.data,
    queryFn: async () => {
      const [gas, fees] = await Promise.all([
        client!
          .estimateContractGas({ account: agent, address: reverseRegistrar.data!, abi: reverseRegistrarAbi, functionName: "setName", args: [name] })
          .catch(() => 150_000n),
        client!.estimateFeesPerGas(),
      ]);
      return ((gas * 13n) / 10n) * fees.maxFeePerGas;
    },
  });
  const need = needed.data ?? parseEther("0.001");
  const funded = balance.data !== undefined && balance.data.value >= need;
  // Send double what's missing, at least 0.0005 ETH, so a retry doesn't need another top-up.
  const topUp = (() => {
    const missing = need * 2n - (balance.data?.value ?? 0n);
    const min = parseEther("0.0005");
    return missing > min ? missing : min;
  })();

  const fund = async () => {
    const r = await fundTx.run(() => send({ to: agent, value: topUp, chainId: CHAIN_ID }));
    if (r) await balance.refetch();
  };

  const setPrimary = async () => {
    if (!reverseRegistrar.data) return;
    const wallet = createWalletClient({ account: agentAccount(agentKey), chain: sepolia, transport: http(RPC_URL) });
    const r = await nameTx.run(() =>
      wallet.writeContract({ address: reverseRegistrar.data!, abi: reverseRegistrarAbi, functionName: "setName", args: [name] }),
    );
    if (r) await Promise.all([current.refetch(), balance.refetch()]);
  };

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Primary name</h3>
      <Why>
        So apps and explorers show {name} for the agent&apos;s address (<AddressLink address={agent} short />). The agent key sends this
        transaction itself, so it needs a little Sepolia ETH first.
      </Why>
      <p className="text-sm">
        Shown now: <span className="font-mono">{current.isLoading ? "…" : current.data ?? "none"}</span>
        {" · "}Agent balance: <span className="font-mono">{balance.data ? `${Number(formatEther(balance.data.value)).toFixed(5)} ETH` : "…"}</span>
      </p>
      {forward.data !== undefined && !pointsBack && (
        <Notice tone="warning">{name} doesn&apos;t resolve to the agent key yet, so the primary name won&apos;t show. Its address record is written when the session starts.</Notice>
      )}
      <div className="flex flex-wrap gap-2">
        <TxButton tx={fundTx} variant="secondary" onClick={fund} disabled={funded || needed.isLoading}>
          {funded ? "Agent has gas money" : `1. Send ${Number(formatEther(topUp)).toFixed(4)} ETH to the agent`}
        </TxButton>
        <TxButton tx={nameTx} onClick={setPrimary} disabled={!funded || !reverseRegistrar.data || current.data === name}>
          {current.data === name ? "Primary name set" : `2. Set ${name} as its primary name`}
        </TxButton>
      </div>
      <TxStatus tx={fundTx} showEvents={false} />
      <TxStatus tx={nameTx} showEvents={false} />
    </section>
  );
}
