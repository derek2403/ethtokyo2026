"use client";

import { Badge, ErrorText, Field, Input, Notice } from "@/components/ui";
import { ADMIN_SIGN_IN, envTemplate, errorText, funderOf } from "@/lib/relay/browser";
import type { StatusResponse } from "@/lib/relay/types";

import { CodeBlock } from "./Checklist";

/** One line saying what the relay serves, or exactly what to configure. */
export function StatusLine({
  status,
  error,
  loading,
  draftRoot,
  draftProblem,
  onDraftRoot,
}: {
  status: StatusResponse | undefined;
  error: Error | null;
  loading: boolean;
  draftRoot: string;
  draftProblem: string | null;
  onDraftRoot: (name: string) => void;
}) {
  if (loading) return <p className="text-sm text-zinc-500">Checking the relay…</p>;

  const nameInput = (
    <Field label="Company name">
      <div className="flex flex-col gap-1">
        <Input value={draftRoot} onChange={(e) => onDraftRoot(e.target.value)} placeholder="acme.eth" className="max-w-xs" />
        <ErrorText>{draftProblem}</ErrorText>
      </div>
    </Field>
  );

  if (error || !status) {
    return (
      <Notice tone="warning" title="Can't reach the relay API">
        <div className="flex flex-col gap-3">
          <p>
            {error ? errorText(error) : "No response"} (GET /api/relay/status). Chain actions below still work on the company name
            you type here.
          </p>
          {nameInput}
        </div>
      </Notice>
    );
  }

  // Keys the relay holds; the rest of the catalog can still be delegated, calls are refused until a key is set.
  const withKey = status.providers.filter((p) => p.configured);
  const noKey = status.providers.filter((p) => !p.configured);
  const providers = (
    <span className="flex flex-wrap items-center gap-1.5">
      {withKey.map((p) => (
        <Badge key={p.id} tone="success">
          {p.label}
        </Badge>
      ))}
      {withKey.length === 0 && <Badge tone="warning">no API keys yet</Badge>}
      {noKey.length > 0 && (
        <span className="text-xs text-zinc-500" title={noKey.map((p) => p.label).join(", ")}>
          {noKey.length} more without a key
        </span>
      )}
    </span>
  );

  if (!status.root) {
    return (
      <Notice tone="warning" title="The relay doesn't know your company name yet">
        <div className="flex flex-col gap-3">
          <p>
            Put this in <code>.env.local</code> (only the keys you have) and restart <code>npm run dev</code>. You can set up the
            name below first.
          </p>
          {nameInput}
          <CodeBlock text={envTemplate(draftRoot.trim() || "acme.eth")} />
          <div className="flex flex-wrap items-center gap-2 text-xs">Providers now: {providers}</div>
        </div>
      </Notice>
    );
  }

  const funder = funderOf(status);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-zinc-200 px-4 py-3 text-sm dark:border-zinc-800">
      <span>
        Relay for <span className="font-mono font-semibold">{status.root}</span>
      </span>
      {providers}
      <span className="text-xs text-zinc-500">
        Base URL <span className="font-mono">{status.baseUrl}</span>
      </span>
      {funder?.enabled && <span className="text-xs text-zinc-500">New members get {funder.amountEth} Sepolia ETH for gas</span>}
      {funder && !funder.enabled && (
        <span className="text-xs text-amber-700 dark:text-amber-400">
          {funder.error ?? "No funder: new members get no gas (set FUNDER_PRIVATE_KEY)."}
        </span>
      )}
      {status.viewAuth === "token" && (
        <span className="text-xs text-zinc-500">
          Spend and the log need the{" "}
          {/* A route handler that serves its own HTML, not a Next page, so it needs a full page load. */}
          <a href={ADMIN_SIGN_IN} className="text-sky-600 hover:underline dark:text-sky-400">
            admin sign-in
          </a>
        </span>
      )}
      {status.viewAuth === "closed" && (
        <span className="text-xs text-zinc-500">Set RELAY_ADMIN_TOKEN on the relay to see spend and the log here.</span>
      )}
      {status.rootWarning && <p className="w-full text-xs text-amber-700 dark:text-amber-400">{status.rootWarning}</p>}
      {status.meterError && <p className="w-full text-xs text-red-600 dark:text-red-400">{status.meterError}</p>}
    </div>
  );
}
