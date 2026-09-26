"use client";

import { useState } from "react";
import { usePublicClient } from "wagmi";

import { Badge, Button, Card, Field, Input, KV } from "@/components/ui";
import { formatError } from "@/lib/ens/errors";
import { splitFirst, tryNormalize } from "@/lib/ens/names";
import { dnsAliasEnvLine, dnsAliasRecord } from "@/lib/relay/browser";
import { RECORD_KEYS } from "@/lib/relay/bundle";
import type { StatusResponse } from "@/lib/relay/types";
import { CHAIN_ID } from "@/lib/wagmi";

import { CodeBlock, Why } from "./Checklist";

type Lookup = { address: string | null; keys: string | null; error: string | null };

/** Lets people use x.acme.com instead of x.acme.eth, via a DNSSEC TXT record and the DNSAliasResolver. */
export function DnsAlias({ root, alias }: { root: string | null; alias: StatusResponse["dnsAlias"] | undefined }) {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const [domainInput, setDomainInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ dns: Lookup; ens: Lookup; domain: string } | null>(null);

  if (!root) {
    return (
      <Card title="Use your company domain">
        <Why>Set a company name first.</Why>
      </Card>
    );
  }

  const placeholder = `${splitFirst(root)[0]}.com`;
  const domain = tryNormalize(domainInput || placeholder);
  const record = domain ? dnsAliasRecord(domain, root) : null;

  const lookup = async (name: string): Promise<Lookup> => {
    try {
      const [address, keys] = await Promise.all([
        client!.getEnsAddress({ name }),
        client!.getEnsText({ name, key: RECORD_KEYS.keys }),
      ]);
      return { address: address ?? null, keys: keys ?? null, error: null };
    } catch (e) {
      return { address: null, keys: null, error: formatError(e) };
    }
  };

  const check = async () => {
    if (!domain || !client) return;
    setBusy(true);
    const [dns, ens] = await Promise.all([lookup(domain), lookup(root)]);
    setResult({ dns, ens, domain });
    setBusy(false);
  };

  const same =
    result && !result.dns.error && (result.dns.keys || result.dns.address)
      ? result.dns.keys === result.ens.keys && result.dns.address === result.ens.address
      : false;

  return (
    <Card
      title="Use your company domain"
      description={`Let people and agents use names like laptop.derek.${placeholder} instead of .eth names.`}
    >
      <Field label="Your domain">
        <Input value={domainInput} onChange={(e) => setDomainInput(e.target.value)} placeholder={placeholder} className="max-w-xs" />
      </Field>
      {record && domain && (
        <>
          <p className="text-sm">
            1. At your DNS provider, turn on <strong>DNSSEC</strong> for {domain} (required), then add this TXT record on{" "}
            <span className="font-mono">{domain}</span>, and the same on <span className="font-mono">*.{domain}</span> for the names under it:
          </p>
          <CodeBlock text={record.txt} />
          <Why>
            With it, {domain} resolves as {root}, and x.{domain} as x.{root}.
          </Why>
          <p className="text-sm">2. Tell the relay, in .env.local (then restart):</p>
          <CodeBlock text={dnsAliasEnvLine(domain, root)} />
          {alias && (
            <p className="text-xs text-zinc-500">
              The relay currently maps {alias.from} → {alias.to}.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => void check()} disabled={busy}>
              {busy ? "Checking…" : `Check ${domain}`}
            </Button>
            {result && result.domain === domain && <Badge tone={same ? "success" : "warning"}>{same ? `resolves like ${root}` : "not working yet"}</Badge>}
          </div>
          {result && result.domain === domain && (
            <KV
              rows={[
                [domain, result.dns.error ?? `address ${result.dns.address ?? "none"} · ${RECORD_KEYS.keys} ${result.dns.keys || "none"}`],
                [root, result.ens.error ?? `address ${result.ens.address ?? "none"} · ${RECORD_KEYS.keys} ${result.ens.keys || "none"}`],
              ]}
            />
          )}
          <Why>DNS changes can take a while to show up. This path hasn&apos;t been tested end to end on Sepolia.</Why>
        </>
      )}
    </Card>
  );
}
