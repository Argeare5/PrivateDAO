import type {
  CapabilityId,
  ExecutionIntent,
  ExecutionReceipt,
  ExecutionState,
  NetworkId,
  PreparedExecution,
  ProviderId,
} from "./index.js";
import { getNetwork } from "./networks.js";
import type { FeeEstimate, NetworkAdapter } from "./protocol.js";

export type StellarEnvironment = "testnet";

export interface StellarNetworkConfig {
  network: NetworkId;
  label: string;
  environment: StellarEnvironment;
  networkPassphrase: string;
  horizonUrlEnv: string;
  explorerBaseUrl: string;
  nativeAsset: "XLM";
  broadcastEnabled: false;
}

export const STELLAR_TESTNET_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

export const STELLAR_NETWORK_CONFIGS: readonly StellarNetworkConfig[] = [
  {
    network: "stellar-testnet",
    label: "Stellar Testnet",
    environment: "testnet",
    networkPassphrase: STELLAR_TESTNET_NETWORK_PASSPHRASE,
    horizonUrlEnv: "PDAO_STELLAR_TESTNET_HORIZON_URL",
    explorerBaseUrl: "https://stellar.expert/explorer/testnet/tx/",
    nativeAsset: "XLM",
    broadcastEnabled: false,
  },
];

export interface StellarUnsignedPayload {
  kind: "stellar-operation-intent";
  network: "stellar-testnet";
  networkPassphrase: string;
  capability: CapabilityId;
  product: string;
  payload: unknown;
  accounts: readonly { role: string; address: string }[];
}

export interface StellarSignedPayload {
  kind: "stellar-signed-xdr";
  network: "stellar-testnet";
  signedTransactionXdr: string;
}

type HorizonTransaction = {
  hash?: unknown;
  successful?: unknown;
  ledger?: unknown;
  created_at?: unknown;
  source_account?: unknown;
  fee_charged?: unknown;
};

type HorizonRoot = {
  network_passphrase?: unknown;
  latest_ledger?: unknown;
};

type HorizonFeeStats = { fee_charged?: { p10?: unknown }; max_fee?: { mode?: unknown } };
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface StellarTransport {
  health(): Promise<{ ok: boolean; network: NetworkId; ledger?: string; latencyMs?: number; reason?: string }>;
  prepare<TPayload, TUnsigned>(intent: ExecutionIntent<TPayload>): Promise<PreparedExecution<TUnsigned>>;
  submit<TUnsigned>(execution: PreparedExecution<TUnsigned>, signedPayload: TUnsigned): Promise<{ executionId: string; signatures: string[] }>;
  status(executionId: string): Promise<{ executionId: string; state: ExecutionState; errorCode?: string }>;
  receipt<TResult = unknown>(executionId: string): Promise<ExecutionReceipt<TResult>>;
  estimateFee<TPayload>(intent: ExecutionIntent<TPayload>): Promise<FeeEstimate>;
}

type StellarRecord = {
  intent: ExecutionIntent<unknown>;
  state: ExecutionState;
  preparedAt: string;
  transactionHash?: string;
};

const DEFAULT_HORIZON_URL = "https://horizon-testnet.stellar.org";

/**
 * Horizon boundary for Stellar. Product code only supplies a workflow intent;
 * XDR construction/signing stays outside this adapter. Broadcast is fail-closed
 * until a separately approved signer and E2E run are configured.
 */
export class StellarHorizonTransport implements StellarTransport {
  private readonly records = new Map<string, StellarRecord>();
  private readonly horizonUrl: string;

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    horizonUrl = process.env.PDAO_STELLAR_TESTNET_HORIZON_URL?.trim() || DEFAULT_HORIZON_URL,
    private readonly broadcastEnabled = process.env.PDAO_STELLAR_TESTNET_BROADCAST_ENABLED === "1",
  ) {
    if (!/^https:\/\//i.test(horizonUrl)) throw new Error("Stellar Horizon must use HTTPS.");
    this.horizonUrl = horizonUrl.replace(/\/$/, "");
    if (broadcastEnabled) throw new Error("Stellar Testnet broadcast is disabled in this release; use an explicitly reviewed signer path.");
  }

  async health(): Promise<{ ok: boolean; network: NetworkId; ledger?: string; latencyMs?: number; reason?: string }> {
    const started = Date.now();
    try {
      const root = await this.request<HorizonRoot>("/");
      if (root.network_passphrase !== STELLAR_TESTNET_NETWORK_PASSPHRASE) {
        return { ok: false, network: "stellar-testnet", reason: "network_passphrase_mismatch" };
      }
      return {
        ok: true,
        network: "stellar-testnet",
        ledger: typeof root.latest_ledger === "number" ? String(root.latest_ledger) : undefined,
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      return { ok: false, network: "stellar-testnet", latencyMs: Date.now() - started, reason: error instanceof Error ? error.message : "horizon_unavailable" };
    }
  }

  async prepare<TPayload, TUnsigned>(intent: ExecutionIntent<TPayload>): Promise<PreparedExecution<TUnsigned>> {
    const health = await this.health();
    if (!health.ok) throw new Error(`Stellar Horizon is not ready: ${health.reason || "unknown"}`);
    const executionId = `stellar-${intent.context.requestId}`;
    const unsignedPayload: StellarUnsignedPayload = {
      kind: "stellar-operation-intent",
      network: "stellar-testnet",
      networkPassphrase: STELLAR_TESTNET_NETWORK_PASSPHRASE,
      capability: intent.context.capability,
      product: intent.context.product,
      payload: intent.payload,
      accounts: intent.accounts.map(({ role, address }) => ({ role, address })),
    };
    this.records.set(executionId, { intent: intent as ExecutionIntent<unknown>, state: "prepared", preparedAt: new Date().toISOString() });
    return {
      executionId,
      intent,
      unsignedPayload: unsignedPayload as TUnsigned,
      requiredSigners: intent.accounts.filter((account) => account.role === "authority" || account.role === "payer"),
      state: "awaiting_signature",
      signingMode: "browser",
    };
  }

  async submit<TUnsigned>(execution: PreparedExecution<TUnsigned>, signedPayload: TUnsigned): Promise<{ executionId: string; signatures: string[] }> {
    if (this.broadcastEnabled) throw new Error("Stellar Testnet broadcast is disabled by policy.");
    const payload = signedPayload as Partial<StellarSignedPayload>;
    if (payload.kind !== "stellar-signed-xdr" || payload.network !== "stellar-testnet" || typeof payload.signedTransactionXdr !== "string") {
      throw new Error("Stellar submit requires a signed Testnet XDR payload.");
    }
    throw new Error("Stellar broadcast is disabled; no transaction was sent.");
  }

  async status(executionId: string): Promise<{ executionId: string; state: ExecutionState; errorCode?: string }> {
    const record = this.records.get(executionId);
    if (!record) throw new Error("Unknown Stellar execution.");
    if (!record.transactionHash) return { executionId, state: record.state };
    const transaction = await this.transaction(record.transactionHash);
    return { executionId, state: transaction.successful ? "confirmed" : "failed" };
  }

  async receipt<TResult = unknown>(executionId: string): Promise<ExecutionReceipt<TResult>> {
    const record = this.records.get(executionId);
    if (!record?.transactionHash) throw new Error("Stellar execution has no observed transaction hash.");
    const transaction = await this.transaction(record.transactionHash);
    if (typeof transaction.hash !== "string" || typeof transaction.successful !== "boolean" || typeof transaction.ledger !== "number") {
      throw new Error("Stellar Horizon returned a malformed transaction receipt.");
    }
    if (!transaction.successful) throw new Error("Stellar transaction failed on Testnet.");
    return {
      executionId,
      requestId: record.intent.context.requestId,
      capability: record.intent.context.capability,
      network: "stellar-testnet",
      provider: "stellar-testnet-horizon",
      state: "confirmed",
      signatures: [transaction.hash],
      result: transaction as TResult,
      createdAt: typeof transaction.created_at === "string" ? transaction.created_at : new Date().toISOString(),
      environment: "testnet",
      chainId: STELLAR_TESTNET_NETWORK_PASSPHRASE,
      asset: "XLM",
      blockNumber: String(transaction.ledger),
      explorerUrl: `${this.horizonUrl.replace("horizon-testnet.stellar.org", "stellar.expert/explorer/testnet/tx")}/${transaction.hash}`,
    };
  }

  async estimateFee<TPayload>(_intent: ExecutionIntent<TPayload>): Promise<FeeEstimate> {
    const stats = await this.request<HorizonFeeStats>("/fee_stats");
    const fee = typeof stats.fee_charged?.p10 === "number" ? String(stats.fee_charged.p10) : "100";
    return { network: "stellar-testnet", atomicAmount: fee, asset: "stroops", expiresAt: new Date(Date.now() + 60_000).toISOString() };
  }

  private async transaction(hash: string): Promise<HorizonTransaction> {
    return this.request<HorizonTransaction>(`/transactions/${encodeURIComponent(hash)}`);
  }

  private async request<T>(path: string): Promise<T> {
    const response = await this.fetchImpl(`${this.horizonUrl}${path}`, { headers: { Accept: "application/json" } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Stellar Horizon HTTP ${response.status}`);
    return body as T;
  }
}

export class StellarAdapterError extends Error {
  constructor(readonly code: "NETWORK_MISMATCH" | "MALFORMED_RECEIPT" | "RPC_FAILURE" | "RPC_TIMEOUT" | "UNSUPPORTED_CAPABILITY", message: string) {
    super(message);
    this.name = "StellarAdapterError";
  }
}

export class StellarNetworkAdapter implements NetworkAdapter {
  readonly id: ProviderId;
  readonly networks: readonly NetworkId[];
  readonly descriptor;
  private readonly capabilities: ReadonlySet<CapabilityId>;

  constructor(input: { id: ProviderId; config: StellarNetworkConfig; capabilities: readonly CapabilityId[]; transport: StellarTransport }) {
    const descriptor = getNetwork(input.config.network);
    if (descriptor.family !== "stellar" || input.config.network !== "stellar-testnet") throw new StellarAdapterError("NETWORK_MISMATCH", "Stellar adapter requires Stellar Testnet.");
    if (input.config.environment !== "testnet" || input.config.broadcastEnabled) throw new StellarAdapterError("NETWORK_MISMATCH", "Only the fail-closed Stellar Testnet lane is available.");
    if (input.capabilities.length === 0) throw new StellarAdapterError("UNSUPPORTED_CAPABILITY", "Stellar adapter requires explicit capabilities.");
    this.id = input.id;
    this.networks = [input.config.network];
    this.descriptor = descriptor;
    this.capabilities = new Set(input.capabilities);
    this.config = input.config;
    this.transport = input.transport;
  }

  readonly config: StellarNetworkConfig;
  private readonly transport: StellarTransport;

  supports(capability: CapabilityId): boolean { return this.capabilities.has(capability); }

  async prepare<TPayload, TUnsigned>(intent: ExecutionIntent<TPayload>): Promise<PreparedExecution<TUnsigned>> {
    this.assertIntent(intent);
    return this.transport.prepare(intent);
  }

  submit<TUnsigned>(execution: PreparedExecution<TUnsigned>, signedPayload: TUnsigned): Promise<{ executionId: string; signatures: string[] }> {
    this.assertIntent(execution.intent);
    return this.transport.submit(execution, signedPayload);
  }

  status(executionId: string): Promise<{ executionId: string; state: ExecutionState; errorCode?: string }> { return this.transport.status(executionId); }
  receipt<TResult = unknown>(executionId: string): Promise<ExecutionReceipt<TResult>> { return this.transport.receipt<TResult>(executionId); }
  estimateFee<TPayload>(intent: ExecutionIntent<TPayload>): Promise<FeeEstimate> { this.assertIntent(intent); return this.transport.estimateFee(intent); }
  health() { return this.transport.health(); }
  explorerUrl(reference: string): string { return `${this.config.explorerBaseUrl}${encodeURIComponent(reference)}`; }

  private assertIntent<TPayload>(intent: ExecutionIntent<TPayload>): void {
    if (intent.context.network !== this.config.network) throw new StellarAdapterError("NETWORK_MISMATCH", "Execution intent targets a different network.");
    if (!this.supports(intent.context.capability)) throw new StellarAdapterError("UNSUPPORTED_CAPABILITY", `Capability is not enabled: ${intent.context.capability}`);
  }
}
