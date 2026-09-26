"use client";

import type { Address } from "viem";

import { TxButton, TxStatus } from "@/components/Tx";
import { useMyResolver } from "@/lib/hooks/useMyResolver";
import { useRelayRefresh } from "@/lib/hooks/useRelayApi";
import { useRelaySubnameSetup } from "@/lib/hooks/useRelaySetup";

/**
 * Deploys the wallet's own registry for `name` and hooks it into the parent,
 * so names can be added below. With `withResolver`, deploys the wallet's
 * resolver first (it will hold the bundles of the new names).
 */
export function SubnameSetup({
  name,
  parentRegistry,
  withResolver = false,
  cta,
}: {
  name: string;
  parentRegistry: Address;
  withResolver?: boolean;
  cta: string;
}) {
  const setup = useRelaySubnameSetup(name, parentRegistry);
  const my = useMyResolver();
  const refresh = useRelayRefresh();
  const needResolver = withResolver && !my.deployed;

  const run = async () => {
    if (needResolver && !(await setup.deployResolver())) return;
    const ok = await setup.runAll();
    await refresh();
    return ok;
  };

  // Plain words for: deploy the UserRegistry, setSubregistry on the parent, setParent back.
  const steps: [boolean, string][] = [
    ...(withResolver ? [[my.deployed, "Your resolver (holds the limits of names you add)"] as [boolean, string]] : []),
    [setup.deployed, `Create a place for names under ${name}`],
    [setup.attached, `Connect it to ${name}`],
    [setup.parentOk, `Confirm it belongs to ${name} (so the relay trusts it)`],
  ];

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1 text-xs">
        {steps.map(([done, label], i) => (
          <li key={i} className={done ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-500"}>
            {done ? "✓" : "○"} {label}
          </li>
        ))}
      </ul>
      {setup.other && (
        <p className="text-xs text-amber-600">
          {name} already has names below it from an earlier setup. Continuing replaces them, and they stop working.
        </p>
      )}
      {!(setup.done && !needResolver) && (
        <div>
          <TxButton tx={setup.tx} onClick={run} disabled={setup.loading || my.loading}>
            {cta}
          </TxButton>
        </div>
      )}
      <TxStatus tx={setup.tx} showEvents={false} />
    </div>
  );
}
