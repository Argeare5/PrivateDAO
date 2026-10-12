import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  InMemoryProviderRegistry,
  InMemoryProtocolRegistry,
  PrivateDaoKernel,
  ProductExecutionGateway,
  registerCatalogCapabilities,
  STELLAR_KERNEL_CAPABILITIES,
  STELLAR_NETWORK_CONFIGS,
  StellarHorizonTransport,
  StellarNetworkAdapter,
} from "../packages/privatedao-runtime/src/index.ts";

if (process.env.PDAO_STELLAR_TESTNET_E2E_APPROVED !== "1"
  || process.env.PDAO_STELLAR_TESTNET_BROADCAST_ENABLED !== "1"
  || process.env.PDAO_STELLAR_AGENT_E2E_APPROVED !== "1") {
  throw new Error("Stellar Agent Exchange E2E requires explicit Testnet, broadcast, and Agent approval gates.");
}

const envFile = process.env.PDAO_STELLAR_TESTNET_SIGNER_ENV_FILE;
if (!envFile) throw new Error("PDAO_STELLAR_TESTNET_SIGNER_ENV_FILE is required.");
const envText = await readFile(envFile, "utf8");
const values = Object.fromEntries(envText.split(/\r?\n/)
  .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/))
  .filter(Boolean)
  .map((match) => [match[1], match[2].trim()]));
const publicKey = values.STELLAR_TESTNET_PUBLIC_KEY;
const secretKey = values.STELLAR_TESTNET_SECRET_KEY;
if (!publicKey || !secretKey) throw new Error("Stellar signer file is missing signer material.");

const { Keypair, Networks, TransactionBuilder } = await import("@stellar/stellar-sdk");
const signer = Keypair.fromSecret(secretKey);
assert.equal(signer.publicKey(), publicKey, "Stellar signer identity mismatch.");

const mcpUrl = (process.env.PRIVATEDAO_AGENT_EXCHANGE_MCP_URL || "https://agents.privatedao.org/mcp").replace(/\/$/, "");
let requestId = 0;
async function mcpCall(method, params = {}) {
  const id = ++requestId;
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.jsonrpc !== "2.0" || body.id !== id || body.error) {
    throw new Error(`MCP ${method} failed: HTTP ${response.status}`);
  }
  return body.result;
}

async function acceptInitializedNotification() {
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok && response.status !== 202) throw new Error(`MCP initialized notification failed: HTTP ${response.status}`);
}

const initialize = await mcpCall("initialize", {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "privatedao-stellar-agent-e2e", version: "1.0.0" },
});
assert.equal(typeof initialize?.serverInfo?.name, "string");
await acceptInitializedNotification();
const tools = await mcpCall("tools/list");
assert(Array.isArray(tools?.tools) && tools.tools.some((tool) => tool.name === "pdao_services"));
const services = await mcpCall("tools/call", { name: "pdao_services", arguments: {} });
assert(Array.isArray(services?.structuredContent?.services));
const safe = await mcpCall("tools/call", {
  name: "verify_basic",
  arguments: { record: { source: "stellar-agent-e2e", purpose: "safe-read-only-compatibility-check", version: 1 } },
});
assert.equal(safe?.isError, false);

const digest = (label, value) => createHash("sha256").update(`${label}:${JSON.stringify(value)}`).digest("hex");
const external = {
  endpoint: mcpUrl,
  server: initialize.serverInfo.name,
  protocolVersion: initialize.protocolVersion,
  toolCount: tools.tools.length,
  serviceCount: services.structuredContent.services.length,
  safeTool: "verify_basic",
};

const horizon = process.env.PDAO_STELLAR_TESTNET_HORIZON_URL?.replace(/\/$/, "") || "https://horizon-testnet.stellar.org";
const config = STELLAR_NETWORK_CONFIGS[0];
const transport = new StellarHorizonTransport(fetch, horizon, true);
const adapter = new StellarNetworkAdapter({
  id: "privatedao-stellar-testnet-agent-e2e",
  config,
  capabilities: STELLAR_KERNEL_CAPABILITIES,
  transport,
});
const providers = new InMemoryProviderRegistry();
providers.register(adapter);
const protocols = new InMemoryProtocolRegistry();
registerCatalogCapabilities(protocols);
const gateway = new ProductExecutionGateway(new PrivateDaoKernel(providers), protocols);
assert.equal((await transport.health()).ok, true);

const cases = [
  ["agent.discover", services.structuredContent.services],
  ["agent.invoke", safe.structuredContent ?? safe.content ?? safe],
];
const results = [];
for (const [capability, result] of cases) {
  const requestIdValue = `stellar-agent-e2e-${capability}-${Date.now()}`;
  const workflow = {
    workflowId: `stellar-testnet:${capability}:${requestIdValue}`,
    inputCommitment: digest(`${capability}:input`, result),
  };
  const intent = {
    context: {
      requestId: requestIdValue,
      idempotencyKey: requestIdValue,
      organizationId: "privatedao-stellar-agent-e2e",
      actorId: "stellar-testnet-authorized-signer",
      product: "agent",
      capability,
      network: "stellar-testnet",
      provider: adapter.id,
    },
    payload: {
      kind: "stellar-payment",
      destination: publicKey,
      amount: "0.000001",
      memo: capability === "agent.discover" ? "PDAO-AGENT-DISC" : "PDAO-AGENT-INVOKE",
      workflow,
    },
    accounts: [{ role: "payer", address: publicKey, network: "stellar-testnet" }],
  };
  const prepared = await gateway.prepare(intent, "maker");
  const transaction = TransactionBuilder.fromXDR(prepared.unsignedPayload.transactionXdr, Networks.TESTNET);
  transaction.sign(signer);
  const submitted = await gateway.submit(prepared, {
    kind: "stellar-signed-xdr",
    network: "stellar-testnet",
    signedTransactionXdr: transaction.toXDR(),
  }, "maker");
  let status;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    status = await gateway.status(prepared, "maker");
    if (status.state === "confirmed" || status.state === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  assert.equal(status?.state, "confirmed", `${capability} did not confirm`);
  const receipt = await gateway.receipt(prepared, "maker");
  results.push({ capability, transactionHash: submitted.signatures[0], ledger: receipt.blockNumber, explorerUrl: receipt.explorerUrl, workflow: receipt.metadata });
}

const evidence = {
  schema: "privatedao.stellar-testnet-agent-e2e.v1",
  network: "stellar-testnet",
  environment: "testnet",
  product: "agent",
  provider: "stellar-testnet-horizon",
  executionPath: "external-mcp->product-gateway->protocol->kernel->stellar-adapter->horizon",
  mcp: external,
  signerPublicKey: publicKey,
  commercialPaymentRail: "solana-mainnet-usdc",
  broadcastExecuted: true,
  results,
  generatedAt: new Date().toISOString(),
};
await mkdir("docs/evidence", { recursive: true });
await writeFile("docs/evidence/stellar-testnet-agent-e2e.json", `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
