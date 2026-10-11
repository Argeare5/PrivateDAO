import assert from "node:assert/strict";
import {
  STELLAR_NETWORK_CONFIGS,
  StellarHorizonTransport,
  StellarNetworkAdapter,
} from "../packages/privatedao-runtime/src/index.ts";

const txHash = "591cb9a2bd0eba190a532b6592a7b277e6a24d84d7966d9b98c485dca1e0b769";
const horizon = process.env.PDAO_STELLAR_TESTNET_HORIZON_URL?.replace(/\/$/, "") || "https://horizon-testnet.stellar.org";
const config = STELLAR_NETWORK_CONFIGS[0];
const capabilities = [
  "verification.blind.prove",
  "verification.record.create",
  "verification.record.verify",
  "payroll.calculate",
  "payroll.approve",
  "treasury.policy.check",
  "governance.proposal.execute",
  "auction.bid.commit",
  "auction.settle",
];

const transport = new StellarHorizonTransport(fetch, horizon);
const adapter = new StellarNetworkAdapter({ id: "test-stellar", config, capabilities, transport });
const health = await transport.health();
assert.equal(health.ok, true, `Stellar Horizon health failed: ${health.reason || "unknown"}`);
assert.equal(health.network, "stellar-testnet");

const response = await fetch(`${horizon}/transactions/${txHash}`, { headers: { Accept: "application/json" } });
assert.equal(response.ok, true, `Known Stellar evidence transaction HTTP ${response.status}`);
const transaction = await response.json();
assert.equal(transaction.hash, txHash);
assert.equal(transaction.successful, true);
assert.equal(typeof transaction.ledger, "number");

for (const capability of capabilities) {
  const prepared = await adapter.prepare({
    context: {
      requestId: `stellar-test-${capability}`,
      idempotencyKey: `stellar-test-${capability}`,
      product: capability.startsWith("verification") ? (capability === "verification.blind.prove" ? "blind-verification" : "record-verification") : capability.startsWith("payroll") ? "payroll" : capability.startsWith("treasury") ? "treasury" : capability.startsWith("governance") ? "governance" : "auction",
      capability,
      network: "stellar-testnet",
    },
    payload: { kind: "readiness-probe", capability },
    accounts: [],
  });
  assert.equal(prepared.state, "awaiting_signature");
  assert.equal(prepared.unsignedPayload.network, "stellar-testnet");
}

await assert.rejects(
  () => adapter.prepare({
    context: { requestId: "wrong-network", idempotencyKey: "wrong-network", product: "treasury", capability: "treasury.policy.check", network: "ethereum-sepolia" },
    payload: {},
    accounts: [],
  }),
  /different network|targets a different network/i,
);

const prepared = await adapter.prepare({
  context: { requestId: "broadcast-guard", idempotencyKey: "broadcast-guard", product: "treasury", capability: "treasury.policy.check", network: "stellar-testnet" },
  payload: {},
  accounts: [],
});
await assert.rejects(
  () => adapter.submit(prepared, { kind: "stellar-signed-xdr", network: "stellar-testnet", signedTransactionXdr: "redacted-test-payload" }),
  /broadcast is disabled/i,
);

console.log(`[stellar-kernel] PASS health=1 known_tx=1 ledger=${transaction.ledger} product_capabilities=${capabilities.length} broadcast=disabled`);
