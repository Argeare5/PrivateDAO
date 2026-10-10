import * as http from "node:http";

import {
  AuctionBidCommitProvider,
  AuctionOutcomeProofProvider,
  BlindPolicyProofProvider,
  InMemoryProviderRegistry,
  PayrollApprovalProvider,
  PayrollCalculationProvider,
  RecordCreationProvider,
  RecordVerificationProvider,
  TreasuryPolicyProvider,
  createPrivateDaoRuntime,
  type ExecutionIntent,
  type ExecutionState,
  type KernelProvider,
  type NetworkId,
  type PreparedExecution,
  type ProtocolRole,
} from "../packages/privatedao-runtime/src/index.ts";

const host = process.env.PDAO_KERNEL_GATEWAY_HOST || "127.0.0.1";
const port = Number(process.env.PDAO_KERNEL_GATEWAY_PORT || 8790);
const maxBodyBytes = Number(process.env.PDAO_KERNEL_GATEWAY_MAX_BODY_BYTES || 1_000_000);
const allowedOrigin = process.env.PDAO_KERNEL_GATEWAY_ALLOWED_ORIGIN || "http://127.0.0.1:4173";
const requiredToken = process.env.PDAO_KERNEL_GATEWAY_TOKEN?.trim() || "";
const supportedNetworks: readonly NetworkId[] = ["solana-devnet", "ethereum-sepolia", "tempo-testnet", "base-sepolia"];

const registry = new InMemoryProviderRegistry();
const prepared = new Map<string, PreparedExecution<unknown>>();

function scopedProvider(delegate: KernelProvider, network: NetworkId): KernelProvider {
  return {
    id: `${delegate.id}-${network}`,
    networks: [network],
    supports: (capability) => delegate.supports(capability),
    prepare: (intent) => {
      if (intent.context.network !== network) throw new Error("Provider/network mismatch.");
      return delegate.prepare(intent);
    },
    submit: (execution, signedPayload) => delegate.submit(execution, signedPayload),
    status: (executionId) => delegate.status(executionId),
    receipt: (executionId) => delegate.receipt(executionId),
  };
}

function registerNetworkProviders(network: NetworkId): void {
  const providers: KernelProvider[] = [
    new PayrollCalculationProvider(),
    new PayrollApprovalProvider(),
    new TreasuryPolicyProvider(),
    new RecordCreationProvider(),
    new RecordVerificationProvider(),
    new BlindPolicyProofProvider(),
    new AuctionBidCommitProvider(),
    new AuctionOutcomeProofProvider(),
  ];
  for (const provider of providers) registry.register(scopedProvider(provider, network));
}

for (const network of supportedNetworks) registerNetworkProviders(network);

const runtime = createPrivateDaoRuntime(registry);

function writeJson(res: http.ServerResponse, status: number, body: Record<string, unknown>): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-pdao-gateway-token, x-pdao-role");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.end(JSON.stringify(body));
}

function authorized(req: http.IncomingMessage): boolean {
  return !requiredToken || req.headers["x-pdao-gateway-token"] === requiredToken;
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBodyBytes) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function roleFrom(req: http.IncomingMessage, body: Record<string, unknown>): ProtocolRole {
  const role = req.headers["x-pdao-role"] || body.role;
  return role === "checker" || role === "auditor" || role === "admin" || role === "agent" ? role : "maker";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (req.method === "OPTIONS") return writeJson(res, 204, {});
  if (url.pathname === "/healthz" && req.method === "GET") {
    return writeJson(res, 200, { ok: true, service: "privatedao-kernel-gateway", mode: "kernel", networks: supportedNetworks });
  }
  if (!authorized(req)) return writeJson(res, 401, { ok: false, error: "Kernel gateway authentication required." });
  if (!url.pathname.startsWith("/v1/executions/")) return writeJson(res, 404, { ok: false, error: "Unknown Kernel gateway route." });

  try {
    const body = await readJson(req);
    if (!isRecord(body)) throw new Error("Request body must be an object.");
    const role = roleFrom(req, body);

    if (req.method === "POST" && url.pathname === "/v1/executions/prepare") {
      const intent = body.intent;
      if (!isRecord(intent) || !isRecord(intent.context)) throw new Error("intent.context is required.");
      const network = intent.context.network;
      if (typeof network !== "string" || !supportedNetworks.includes(network as NetworkId)) throw new Error("The selected network is not enabled in this gateway.");
      const result = await runtime.gateway.prepare(intent as unknown as ExecutionIntent, role);
      prepared.set(result.executionId, result as PreparedExecution<unknown>);
      return writeJson(res, 200, result as unknown as Record<string, unknown>);
    }

    if (req.method === "POST" && url.pathname === "/v1/executions/submit") {
      const execution = body.execution;
      if (!isRecord(execution) || typeof execution.executionId !== "string") throw new Error("execution is required.");
      const stored = prepared.get(execution.executionId);
      if (!stored) throw new Error("Execution is not present in this gateway session.");
      const result = await runtime.gateway.submit(stored, body.signedPayload, role);
      return writeJson(res, 200, result);
    }

    const match = url.pathname.match(/^\/v1\/executions\/([^/]+)\/(status|receipt)$/);
    if (req.method === "GET" && match) {
      const execution = prepared.get(decodeURIComponent(match[1]));
      if (!execution) throw new Error("Execution is not present in this gateway session.");
      if (match[2] === "status") return writeJson(res, 200, await runtime.gateway.status(execution, role));
      return writeJson(res, 200, await runtime.gateway.receipt(execution, role) as unknown as Record<string, unknown>);
    }

    return writeJson(res, 404, { ok: false, error: "Unknown execution route." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kernel gateway request failed.";
    return writeJson(res, 400, { ok: false, error: message });
  }
}

http.createServer((req, res) => { void handle(req, res); }).listen(port, host, () => {
  console.log(`PrivateDAO Kernel gateway listening on http://${host}:${port}`);
});
