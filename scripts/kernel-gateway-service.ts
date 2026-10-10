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
  ZalletCliTransport,
  ZcashNetworkAdapter,
  ZCASH_NETWORK_CONFIGS,
  createPrivateDaoRuntime,
  type ExecutionIntent,
  type KernelProvider,
  type NetworkId,
  type PreparedExecution,
  type ProtocolRole,
} from "../packages/privatedao-runtime/src/index.ts";

export type KernelGatewayServiceOptions = {
  allowedOrigin?: string;
  requiredToken?: string;
  maxBodyBytes?: number;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

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

export class KernelGatewayService {
  readonly supportedNetworks: readonly NetworkId[];
  private readonly allowedOrigin: string;
  private readonly requiredToken: string;
  private readonly maxBodyBytes: number;
  private readonly prepared = new Map<string, PreparedExecution<unknown>>();
  private readonly runtime;

  constructor(options: KernelGatewayServiceOptions = {}) {
    this.allowedOrigin = options.allowedOrigin || process.env.PDAO_KERNEL_GATEWAY_ALLOWED_ORIGIN || "*";
    this.requiredToken = options.requiredToken ?? process.env.PDAO_KERNEL_GATEWAY_TOKEN?.trim() ?? "";
    this.maxBodyBytes = options.maxBodyBytes || Number(process.env.PDAO_KERNEL_GATEWAY_MAX_BODY_BYTES || 1_000_000);

    const baseNetworks: readonly NetworkId[] = ["solana-devnet", "ethereum-sepolia", "tempo-testnet", "base-sepolia"];
    const zcashConfigured = Boolean(
      process.env.PDAO_ZCASH_ZALLET_BINARY?.trim()
      && process.env.PDAO_ZCASH_ZALLET_DATA_DIR?.trim()
      && process.env.PDAO_ZCASH_ZALLET_CONFIG?.trim(),
    );
    this.supportedNetworks = zcashConfigured ? [...baseNetworks, "zcash-testnet"] : baseNetworks;

    const registry = new InMemoryProviderRegistry();
    for (const network of this.supportedNetworks) {
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

    if (zcashConfigured) {
      const config = ZCASH_NETWORK_CONFIGS.find((entry) => entry.network === "zcash-testnet");
      if (!config) throw new Error("Zcash Testnet configuration is missing from the Kernel network matrix.");
      const transport = new ZalletCliTransport({
        binaryPath: process.env.PDAO_ZCASH_ZALLET_BINARY!.trim(),
        dataDirectory: process.env.PDAO_ZCASH_ZALLET_DATA_DIR!.trim(),
        configPath: process.env.PDAO_ZCASH_ZALLET_CONFIG!.trim(),
        network: "zcash-testnet",
        explorerBaseUrl: config.explorerBaseUrl,
        confirmationDepth: Number(process.env.PDAO_ZCASH_CONFIRMATIONS || 1),
        allowBalanceReadinessProbe: process.env.PDAO_ZCASH_ALLOW_BALANCE_CHECK === "1",
        broadcastEnabled: process.env.PDAO_ZCASH_BROADCAST_ENABLED === "1",
      });
      registry.register(new ZcashNetworkAdapter({
        id: "privatedao-zcash-testnet-zallet",
        config,
        capabilities: ["payroll.settle"],
        transport,
      }));
    }
    this.runtime = createPrivateDaoRuntime(registry);
  }

  async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    const incomingPath = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`).pathname.replace(/\/+$/, "") || "/";
    const path = incomingPath.startsWith("/api/") ? incomingPath.slice(4) : incomingPath;
    if (path === "/healthz" && req.method === "GET") {
      this.writeJson(res, 200, {
        ok: true,
        service: "privatedao-kernel-gateway",
        mode: "kernel",
        networks: this.supportedNetworks,
        zcash: {
          configured: this.supportedNetworks.includes("zcash-testnet"),
          testnetOnly: true,
          broadcastEnabled: process.env.PDAO_ZCASH_BROADCAST_ENABLED === "1",
        },
      });
      return true;
    }
    if (!path.startsWith("/v1/executions/")) return false;
    if (!this.authorized(req)) {
      this.writeJson(res, 401, { ok: false, error: "Kernel gateway authentication required." });
      return true;
    }
    try {
      const body = await this.readJson(req);
      if (!isRecord(body)) throw new Error("Request body must be an object.");
      const role = this.roleFrom(req, body);
      if (req.method === "POST" && path === "/v1/executions/prepare") {
        const intent = body.intent;
        if (!isRecord(intent) || !isRecord(intent.context)) throw new Error("intent.context is required.");
        const network = intent.context.network;
        if (typeof network !== "string" || !this.supportedNetworks.includes(network as NetworkId)) throw new Error("The selected network is not enabled in this gateway.");
        const result = await this.runtime.gateway.prepare(intent as unknown as ExecutionIntent, role);
        this.prepared.set(result.executionId, result as PreparedExecution<unknown>);
        this.writeJson(res, 200, result as unknown as JsonRecord);
        return true;
      }
      if (req.method === "POST" && path === "/v1/executions/submit") {
        const execution = body.execution;
        if (!isRecord(execution) || typeof execution.executionId !== "string") throw new Error("execution is required.");
        const stored = this.prepared.get(execution.executionId);
        if (!stored) throw new Error("Execution is not present in this gateway session.");
        this.writeJson(res, 200, await this.runtime.gateway.submit(stored, body.signedPayload, role));
        return true;
      }
      const match = path.match(/^\/v1\/executions\/([^/]+)\/(status|receipt)$/);
      if (req.method === "GET" && match) {
        const execution = this.prepared.get(decodeURIComponent(match[1]));
        if (!execution) throw new Error("Execution is not present in this gateway session.");
        if (match[2] === "status") this.writeJson(res, 200, await this.runtime.gateway.status(execution, role));
        else this.writeJson(res, 200, await this.runtime.gateway.receipt(execution, role) as unknown as JsonRecord);
        return true;
      }
      this.writeJson(res, 404, { ok: false, error: "Unknown execution route." });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Kernel gateway request failed.";
      this.writeJson(res, 400, { ok: false, error: message });
      return true;
    }
  }

  private authorized(req: http.IncomingMessage): boolean {
    return !this.requiredToken || req.headers["x-pdao-gateway-token"] === this.requiredToken;
  }

  private roleFrom(req: http.IncomingMessage, body: JsonRecord): ProtocolRole {
    const role = req.headers["x-pdao-role"] || body.role;
    return role === "checker" || role === "auditor" || role === "admin" || role === "agent" ? role : "maker";
  }

  private async readJson(req: http.IncomingMessage): Promise<unknown> {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > this.maxBodyBytes) throw new Error("Request body is too large.");
      chunks.push(buffer);
    }
    if (chunks.length === 0) return {};
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }

  private writeJson(res: http.ServerResponse, status: number, body: JsonRecord): void {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", this.allowedOrigin);
    res.setHeader("Access-Control-Allow-Headers", "content-type, x-pdao-gateway-token, x-pdao-role");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.end(JSON.stringify(body));
  }
}

export function createKernelGatewayService(options?: KernelGatewayServiceOptions): KernelGatewayService {
  return new KernelGatewayService(options);
}
