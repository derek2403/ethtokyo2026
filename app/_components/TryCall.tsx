"use client";

import { useState } from "react";

import { Badge, Button, Card, ErrorText, Field, Input, Select, Textarea } from "@/components/ui";
import { formatError } from "@/lib/ens/errors";
import { useNow } from "@/lib/hooks/useNow";
import { useRelayAgentKeys } from "@/lib/hooks/useRelayAgents";
import { useRelayLog, useRelayPolicy, useRelayStatus } from "@/lib/hooks/useRelayApi";
import { agentToken, errorText, nowSec, sampleRequest, usd } from "@/lib/relay/browser";
import { PROVIDERS } from "@/lib/relay/bundle";
import type { LogEntry } from "@/lib/relay/types";

import { Why } from "./Checklist";

type Req = { method: string; path: string; body: string };
type Result = { status: number; denied: boolean; reason: string | null; body: string; sentAt: number };

// The relay's own refusals carry { error: string }; upstream errors use objects.
const RELAY_ERROR_STATUSES = [400, 401, 403, 404, 413, 502, 503];

const nowMs = () => Date.now();

/** Sends a real request through the relay as one of this browser's agents. */
export function TryCall({ root }: { root: string | null }) {
  const agents = useRelayAgentKeys();
  const status = useRelayStatus();
  const log = useRelayLog(20);
  const now = useNow();
  // Keys made for names under another company root would only get "not under <root>".
  const named = agents.keys.filter((k) => k.name && (!root || k.name === root || k.name.endsWith(`.${root}`)));

  const [agentAddr, setAgentAddr] = useState("");
  const [provider, setProvider] = useState("mock");
  const [edits, setEdits] = useState<Record<string, Req>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const key = named.find((k) => k.address === agentAddr) ?? named[0];
  // The relay's view of the chosen name: is it still live, and when does it end?
  const policy = useRelayPolicy(key?.name ?? null);
  const levels = policy.data?.levels ?? [];
  // The relay lists every level down to the name; no leaf means it can't place the name at all
  // (e.g. no root configured), which it will explain when the call is sent.
  const leaf = levels.find((l) => l.name === key?.name);
  const live = !!leaf && levels.every((l) => l.status === "registered");
  const expiry = live ? leaf.expiry : null;
  const ended = !!leaf && (!live || (expiry !== null && expiry <= (now || nowSec())));
  const sample = sampleRequest(provider);
  const req: Req = edits[provider] ?? { method: sample.method, path: sample.path, body: sample.body ?? "" };
  const setReq = (patch: Partial<Req>) => setEdits({ ...edits, [provider]: { ...req, ...patch } });
  const configured = status.data?.providers.find((p) => p.id === provider)?.configured;

  const send = async () => {
    if (!key?.name) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      // A short-lived token is enough for one test call, and never outlives the session.
      const exp = expiry !== null ? Math.min(nowSec() + 600, expiry) : nowSec() + 600;
      const token = await agentToken(key, key.name, exp);
      const headers: Record<string, string> = sample.auth === "x-api-key" ? { "x-api-key": token } : { authorization: `Bearer ${token}` };
      const hasBody = req.method !== "GET" && req.method !== "HEAD" && req.body.trim() !== "";
      if (hasBody) headers["content-type"] = "application/json";
      const sentAt = nowMs();
      const res = await fetch(`/api/relay/${provider}${req.path.startsWith("/") ? "" : "/"}${req.path}`, {
        method: req.method,
        headers,
        body: hasBody ? req.body : undefined,
      });
      const text = await res.text();
      let json: { error?: unknown; reason?: unknown } | null = null;
      try {
        json = JSON.parse(text);
      } catch {
        // Not JSON (e.g. a stream or an HTML error page).
      }
      const denied = RELAY_ERROR_STATUSES.includes(res.status) && typeof json?.error === "string";
      setResult({
        status: res.status,
        denied,
        reason: denied ? String(json?.reason ?? json?.error) : null,
        body: json ? JSON.stringify(json, null, 2) : text,
        sentAt,
      });
      // The relay logs (and charges) once the response body has been read.
      await log.refetch();
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  };

  const entry: LogEntry | undefined =
    result && key
      ? log.data?.find((e) => e.ts >= result.sentAt - 2000 && e.provider === provider && (e.name === key.name || e.signer === key.address))
      : undefined;

  return (
    <Card title="Try a call" description="Send a request through the relay as one of the agents whose key is in this browser.">
      {named.length === 0 ? (
        <Why>
          No agent keys {root ? `for names under ${root} ` : ""}in this browser yet. Start one under &quot;Browser agent session&quot; above
          (&quot;Generate a demo key in this browser&quot;).
        </Why>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="As agent">
              <Select value={key?.address ?? ""} onChange={(e) => setAgentAddr(e.target.value)}>
                {named.map((k) => (
                  <option key={k.address} value={k.address}>
                    {k.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Provider">
              <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Method">
              <Select value={req.method} onChange={(e) => setReq({ method: e.target.value })}>
                {["GET", "POST"].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
            </Field>
            <Field label="Path">
              <Input value={req.path} onChange={(e) => setReq({ path: e.target.value })} className="w-56" />
            </Field>
          </div>
          {configured === false && <Why>The relay has no key for this provider, so it will refuse the call.</Why>}
          {ended && <Why>This session has ended or was removed, so the relay would refuse it. Extend it in the team tree, or start a new one.</Why>}
          {policy.error && <Why>Couldn&apos;t check the session: {errorText(policy.error)}</Why>}
          {policy.data && !leaf && policy.data.reason && <Why>The relay will refuse it: {policy.data.reason}</Why>}
          {req.method !== "GET" && (
            <Field label="Body">
              <Textarea value={req.body} onChange={(e) => setReq({ body: e.target.value })} rows={5} />
            </Field>
          )}
          <div>
            <Button onClick={() => void send()} disabled={busy || !key || ended || policy.isLoading}>
              {busy ? "Sending…" : "Send"}
            </Button>
          </div>
          <ErrorText>{error}</ErrorText>
          {result && (
            <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={result.denied ? "danger" : "success"}>{result.denied ? "Refused by the relay" : "Allowed"}</Badge>
                <span className="font-mono text-xs">HTTP {result.status}</span>
                {entry?.costUsd !== null && entry?.costUsd !== undefined && (
                  <span className="text-xs">
                    cost {usd(entry.costUsd)}
                    {entry.estimated ? " (estimated)" : ""}
                  </span>
                )}
              </div>
              {result.reason && <p>Why: {result.reason}</p>}
              <pre className="max-h-64 overflow-auto rounded bg-zinc-950 p-3 font-mono text-xs text-zinc-100">{result.body || "(empty)"}</pre>
            </div>
          )}
        </>
      )}
      <ActivityLog entries={log.data} error={log.error} />
    </Card>
  );
}

function ActivityLog({ entries, error }: { entries: LogEntry[] | undefined; error: Error | null }) {
  return (
    <div className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <h3 className="text-sm font-semibold">Relay activity</h3>
      {error ? (
        <Why>Couldn&apos;t load the log: {errorText(error)}</Why>
      ) : !entries?.length ? (
        <Why>No calls yet.</Why>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 pr-3 font-medium">When</th>
                <th className="py-1 pr-3 font-medium">Name</th>
                <th className="py-1 pr-3 font-medium">Call</th>
                <th className="py-1 pr-3 font-medium">Result</th>
                <th className="py-1 font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={`${e.ts}-${i}`} className="border-t border-zinc-100 align-top dark:border-zinc-900">
                  <td className="py-1 pr-3 whitespace-nowrap">{new Date(e.ts).toLocaleTimeString()}</td>
                  <td className="py-1 pr-3 font-mono">{e.name ?? "—"}</td>
                  <td className="py-1 pr-3 font-mono">
                    {e.provider} {e.method} {e.path}
                  </td>
                  <td className="py-1 pr-3">
                    <Badge tone={e.allowed ? "success" : "danger"}>{e.allowed ? `ok${e.status ? ` ${e.status}` : ""}` : "refused"}</Badge>
                    {e.reason && <span className="ml-1 text-zinc-500">{e.reason}</span>}
                  </td>
                  <td className="py-1 whitespace-nowrap">{e.costUsd !== null ? `${usd(e.costUsd)}${e.estimated ? "*" : ""}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
