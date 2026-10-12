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
if (existsSync(payrollEvidencePath)) observed.add("payroll.settle");
if (existsSync(agentEvidencePath)) {
  const agentEvidence = JSON.parse(readFileSync(agentEvidencePath, "utf8"));
  assert.equal(agentEvidence.network, "stellar-testnet");
  assert.equal(agentEvidence.broadcastExecuted, true);
  for (const entry of agentEvidence.results || []) observed.add(entry.capability);
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
