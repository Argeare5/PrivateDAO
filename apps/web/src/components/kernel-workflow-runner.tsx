"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";

type KernelWorkflowRunnerProps = {
  product: string;
  capability: string;
  network: string;
  networkLabel: string;
};

type PreparedExecution = {
  executionId: string;
  state: "prepared" | "awaiting_signature";
  requiredSigners?: Array<{ role?: string; address?: string; network?: string }>;
  intent?: { context?: { network?: string; capability?: string } };
};

const RUNTIME_API_BASE = (process.env.NEXT_PUBLIC_RUNTIME_API_BASE || "https://api.privatedao.org/api").replace(/\/+$/, "");

export function KernelWorkflowRunner({ product, capability, network, networkLabel }: KernelWorkflowRunnerProps) {
  const [busy, setBusy] = useState(false);
  const [prepared, setPrepared] = useState<PreparedExecution | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function prepare() {
    setBusy(true);
    setPrepared(null);
    setError(null);
    const requestId = `web-${product}-${capability}-${network}-${Date.now()}`;
    try {
      const response = await fetch(`${RUNTIME_API_BASE}/v1/executions/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          intent: {
            context: {
              requestId,
              idempotencyKey: requestId,
              product,
              capability,
              actorId: "browser-user",
              network,
            },
            payload: { source: "PrivateDAO product workspace", requestedAt: new Date().toISOString() },
            accounts: [],
          },
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || typeof body.executionId !== "string") {
        throw new Error(typeof body.error === "string" ? body.error : `The selected workflow is unavailable (${response.status}).`);
      }
      setPrepared(body as PreparedExecution);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The selected workflow could not be prepared.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[24px] border border-[#bcd5f7] bg-[#f7fbff] p-5 text-[#10233f]" aria-labelledby="selected-kernel-workflow">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-[#175cd3]"><ShieldCheck className="h-4 w-4" /> Selected workflow</div>
      <h2 id="selected-kernel-workflow" className="mt-3 text-xl font-semibold">Ready this workflow for {networkLabel}</h2>
      <p className="mt-2 text-sm leading-6 text-[#5d6d82]">PrivateDAO sends the selected request through the same execution boundary used by the product runtime. No success is shown unless the connected service returns a real prepared execution.</p>
      <button type="button" onClick={() => void prepare()} disabled={busy} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-[#175cd3] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
        {busy ? "Preparing..." : "Continue with this workflow"}
      </button>
      {prepared ? <div className="mt-4 rounded-[14px] border border-[#bde7d3] bg-[#f1fcf6] p-4 text-sm text-[#14532d]"><strong>Prepared through the runtime</strong><div className="mt-2 text-xs">Execution: <code>{prepared.executionId}</code></div><div className="mt-1 text-xs">State: {prepared.state}</div></div> : null}
      {error ? <div className="mt-4 rounded-[14px] border border-[#f1c7cc] bg-[#fff7f7] p-4 text-sm text-[#8f1d2c]" role="alert">{error}</div> : null}
    </section>
  );
}
