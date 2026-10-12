import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const evidencePath = "docs/evidence/stellar-testnet-payroll-e2e.json";
try {
  await access(evidencePath);
} catch {
  console.error(JSON.stringify({
    status: "BLOCKED",
    network: "stellar-testnet",
    capability: "payroll.settle",
    reason: "confirmed payroll settlement evidence is not present",
    expectedEvidence: evidencePath,
    nextStep: "run the guarded Testnet payroll E2E only after funding and explicit broadcast approval",
  }, null, 2));
  process.exitCode = 2;
  process.exit();
}

const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
assert.equal(evidence.schema, "privatedao.stellar-testnet-payroll-e2e.v1");
assert.equal(evidence.network, "stellar-testnet");
assert.equal(evidence.environment, "testnet");
assert.equal(evidence.broadcastExecuted, true);
assert.equal(evidence.receiptState, "confirmed");
assert.match(evidence.transactionHash, /^[a-f0-9]{64}$/i);
assert.match(String(evidence.ledger), /^\d+$/);
assert.match(evidence.signerPublicKey, /^G[A-Z2-7]{55}$/);
assert.match(evidence.recipient, /^G[A-Z2-7]{55}$/);
assert.equal(evidence.workflow?.policyCommitment?.length, 64);
console.log(JSON.stringify({
  schema: evidence.schema,
  network: evidence.network,
  capability: "payroll.settle",
  state: evidence.receiptState,
  transactionHash: evidence.transactionHash,
  ledger: evidence.ledger,
}, null, 2));
