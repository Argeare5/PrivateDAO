import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { STELLAR_KERNEL_CAPABILITIES } from "../packages/privatedao-runtime/src/index.ts";

const horizon = process.env.PDAO_STELLAR_TESTNET_HORIZON_URL?.replace(/\/$/, "") || "https://horizon-testnet.stellar.org";
const evidencePath = process.env.PDAO_STELLAR_PRODUCT_EVIDENCE || "docs/evidence/stellar-testnet-product-e2e.json";
const evidence = JSON.parse(await readFile(evidencePath, "utf8"));

assert.equal(evidence.schema, "privatedao.stellar-testnet-product-e2e.v1");
assert.equal(evidence.network, "stellar-testnet");
assert.equal(evidence.environment, "testnet");
assert.equal(evidence.provider, "stellar-testnet-horizon");
assert.equal(evidence.executionPath, "product-gateway->protocol->kernel->stellar-adapter->horizon");
assert.equal(evidence.broadcastExecuted, true);
assert.equal(evidence.results.length, STELLAR_KERNEL_CAPABILITIES.length);

const expectedProducts = new Map([
  ["verification.blind.prove", "blind-verification"],
  ["verification.record.create", "record-verification"],
  ["verification.record.verify", "record-verification"],
  ["payroll.calculate", "payroll"],
  ["payroll.approve", "payroll"],
  ["treasury.policy.check", "treasury"],
  ["governance.proposal.execute", "governance"],
  ["auction.bid.commit", "auction"],
  ["auction.settle", "auction"],
]);

const seen = new Set();
for (const result of evidence.results) {
  assert.equal(expectedProducts.get(result.capability), result.product, `wrong product for ${result.capability}`);
  assert.equal(result.network, "stellar-testnet");
  assert.equal(result.provider, "stellar-testnet-horizon");
  assert.equal(result.state, "confirmed");
  assert.match(result.transactionHash, /^[a-f0-9]{64}$/i);
  assert.match(String(result.ledger), /^\d+$/);
  assert.equal(seen.has(result.capability), false, `duplicate evidence for ${result.capability}`);
  seen.add(result.capability);

  const response = await fetch(`${horizon}/transactions/${result.transactionHash}`, { headers: { Accept: "application/json" } });
  assert.equal(response.ok, true, `${result.capability} Horizon HTTP ${response.status}`);
  const transaction = await response.json();
  assert.equal(transaction.hash, result.transactionHash);
  assert.equal(transaction.successful, true, `${result.capability} is not successful on Horizon`);
  assert.equal(String(transaction.ledger), String(result.ledger), `${result.capability} ledger mismatch`);
}

assert.deepEqual([...seen].sort(), [...STELLAR_KERNEL_CAPABILITIES].sort());
console.log(JSON.stringify({
  schema: evidence.schema,
  network: evidence.network,
  provider: evidence.provider,
  executionPath: evidence.executionPath,
  capabilities: seen.size,
  confirmedOnHorizon: true,
  readOnly: true,
}, null, 2));
