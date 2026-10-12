import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const required = [
  "verification.blind.prove",
  "verification.record.create",
  "verification.record.verify",
  "payroll.calculate",
  "payroll.approve",
  "payroll.settle",
  "treasury.policy.check",
  "governance.proposal.execute",
  "auction.bid.commit",
  "auction.settle",
  "agent.discover",
  "agent.invoke",
];
const productEvidence = JSON.parse(readFileSync("docs/evidence/stellar-testnet-product-e2e.json", "utf8"));
const payrollEvidencePath = "docs/evidence/stellar-testnet-payroll-e2e.json";
const agentEvidencePath = "docs/evidence/stellar-testnet-agent-e2e.json";
const observed = new Set((productEvidence.results || []).map((entry) => entry.capability));
function assertReceipt(entry, label) {
  assert.equal(entry.state, "confirmed", `${label} is not confirmed`);
  assert.match(entry.transactionHash || "", /^[a-f0-9]{64}$/i, `${label} has no real transaction hash`);
  assert.match(String(entry.ledger || ""), /^\d+$/, `${label} has no confirmed ledger`);
  assert.match(entry.explorerUrl || "", /^https:\/\/stellar\.expert\/explorer\/testnet\/tx\/[a-f0-9]{64}$/i, `${label} has no Stellar Testnet explorer URL`);
}
assert.equal(productEvidence.network, "stellar-testnet");
assert.equal(productEvidence.broadcastExecuted, true);
for (const entry of productEvidence.results || []) assertReceipt(entry, `product/${entry.capability}`);
if (existsSync(payrollEvidencePath)) {
  const payrollEvidence = JSON.parse(readFileSync(payrollEvidencePath, "utf8"));
  assert.equal(payrollEvidence.network, "stellar-testnet");
  assert.equal(payrollEvidence.broadcastExecuted, true);
  assertReceipt({ state: payrollEvidence.receiptState, transactionHash: payrollEvidence.transactionHash, ledger: payrollEvidence.ledger, explorerUrl: payrollEvidence.explorerUrl }, "payroll/payroll.settle");
  observed.add("payroll.settle");
}
if (existsSync(agentEvidencePath)) {
  const agentEvidence = JSON.parse(readFileSync(agentEvidencePath, "utf8"));
  assert.equal(agentEvidence.network, "stellar-testnet");
  assert.equal(agentEvidence.broadcastExecuted, true);
  for (const entry of agentEvidence.results || []) {
    assertReceipt(entry, `agent/${entry.capability}`);
    observed.add(entry.capability);
  }
}
const missing = required.filter((capability) => !observed.has(capability));
console.log(JSON.stringify({
  network: "stellar-testnet",
  requiredCount: required.length,
  observedCount: required.length - missing.length,
  missing,
  status: missing.length === 0 ? "PASS" : "INCOMPLETE",
}, null, 2));
if (missing.length) process.exitCode = 1;
