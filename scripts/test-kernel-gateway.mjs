import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";

const port = 8791;
const child = spawn("npx", ["tsx", "scripts/kernel-gateway.ts"], {
  cwd: process.cwd(),
    env: { ...process.env, PDAO_KERNEL_GATEWAY_PORT: String(port), PDAO_KERNEL_EVM_BROWSER_ENABLED: "0" },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});

const request = (method, path, body) => new Promise((resolve, reject) => {
  const req = http.request({
    host: "127.0.0.1",
    port,
    path,
    method,
    headers: { "content-type": "application/json" },
  }, (res) => {
    let data = "";
    res.on("data", (chunk) => { data += chunk; });
    res.on("end", () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} }));
  });
  req.on("error", reject);
  if (body !== undefined) req.write(JSON.stringify(body));
  req.end();
});

const waitForHealth = async () => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const response = await request("GET", "/healthz");
      if (response.status === 200) return response.body;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Kernel gateway did not become healthy.");
};

try {
  const health = await waitForHealth();
  const prefixedHealth = await request("GET", "/api/healthz");
  assert.equal(prefixedHealth.status, 200);
  const zcashConfigured = Boolean(process.env.PDAO_ZCASH_ZALLET_BINARY && process.env.PDAO_ZCASH_ZALLET_DATA_DIR && process.env.PDAO_ZCASH_ZALLET_CONFIG);
  const expectedNetworks = ["solana-devnet", "ethereum-sepolia", "arbitrum-sepolia", "tempo-testnet", "base-sepolia", "zcash-testnet"];
  assert.deepEqual(health.networks, expectedNetworks);
  assert.equal(health.networkModes.length, expectedNetworks.length);
  for (const network of expectedNetworks) {
    const mode = health.networkModes.find((entry) => entry.network === network);
    assert.ok(mode, `${network} must have a Kernel network mode`);
    if (network === "zcash-testnet") {
      assert.equal(mode.provider, zcashConfigured ? "privatedao-zcash-testnet-zallet" : "privatedao-kernel-policy");
      assert.equal(mode.onchainAdapter, zcashConfigured);
      assert.equal(mode.ready, false);
    } else if (network === "solana-devnet") {
      assert.equal(mode.provider, "kernel-native");
      assert.equal(mode.onchainAdapter, false);
      assert.equal(mode.ready, false);
    } else {
      assert.equal(mode.provider, "kernel-native");
      assert.equal(mode.onchainAdapter, false);
      assert.equal(mode.ready, false);
    }
  }
  assert.equal(health.zcash.configured, zcashConfigured);
  assert.equal(health.zcash.policyReady, true);
  assert.equal(health.zcash.testnetOnly, true);
  assert.equal(health.zcash.broadcastEnabled, false);

  const baseIntent = (network, requestId) => ({
    context: {
      requestId,
      idempotencyKey: requestId,
      product: "payroll",
      capability: "payroll.calculate",
      actorId: "gateway-test",
      network,
    },
    payload: {
      lines: [{ employeeRef: "employee-1", grossCents: 10000 }],
      policy: {
        network,
        jurisdiction: "demo",
        taxYear: "2026",
        taxRateBps: 1000,
        deductionRateBps: 500,
        maxTotalCents: 20000,
        maxEmployeeCents: 15000,
        allowedAsset: "USDC",
        rounding: "half-up",
      },
    },
    accounts: [],
  });

  for (const network of health.networks) {
    const requestId = `gateway-${network}`;
    const preparePath = network === "solana-devnet" ? "/api/v1/executions/prepare" : "/v1/executions/prepare";
    const first = await request("POST", preparePath, { intent: baseIntent(network, requestId) });
    assert.equal(first.status, 200, `${network} prepare failed`);
    const repeated = await request("POST", "/v1/executions/prepare", { intent: baseIntent(network, requestId) });
    assert.equal(repeated.status, 200, `${network} idempotent prepare failed`);
    assert.equal(repeated.body.executionId, first.body.executionId);

    const submit = await request("POST", "/v1/executions/submit", { execution: first.body, signedPayload: null });
    assert.equal(submit.status, 200, `${network} submit failed`);
    const status = await request("GET", `/v1/executions/${encodeURIComponent(first.body.executionId)}/status`);
    assert.equal(status.status, 200);
    assert.equal(status.body.state, "reconciled");
    const receipt = await request("GET", `/v1/executions/${encodeURIComponent(first.body.executionId)}/receipt`);
    assert.equal(receipt.status, 200);
    assert.equal(receipt.body.network, network);
  }

  const governanceRequest = "gateway-zcash-governance";
  const governanceIntent = {
    context: {
      requestId: governanceRequest,
      idempotencyKey: governanceRequest,
      product: "governance",
      capability: "governance.proposal.execute",
      actorId: "gateway-test",
      network: "zcash-testnet",
    },
    payload: { proposalId: "proposal-1", proposalHash: "hash-1", policyHash: "policy-1", requiredApprovals: 1 },
    accounts: [{ role: "authority", address: "authority-1", network: "zcash-testnet" }],
  };
  const governancePrepared = await request("POST", "/v1/executions/prepare", { intent: governanceIntent });
  assert.equal(governancePrepared.status, 200, "Zcash governance policy prepare failed");
  const governanceSubmit = await request("POST", "/v1/executions/submit", {
    execution: governancePrepared.body,
    signedPayload: { actorId: "authority-1", decision: "approve", signature: "test-signature" },
  });
  assert.equal(governanceSubmit.status, 200, "Zcash governance policy submit failed");
  const governanceReceipt = await request("GET", `/v1/executions/${encodeURIComponent(governancePrepared.body.executionId)}/receipt`);
  assert.equal(governanceReceipt.status, 200, "Zcash governance policy receipt failed");
  assert.equal(governanceReceipt.body.network, "zcash-testnet");
  assert.equal(governanceReceipt.body.result.onchainSettlement, false);

  const malformed = await request("POST", "/v1/executions/prepare", { intent: { context: { network: "not-enabled" } } });
  assert.equal(malformed.status, 400);
  const missing = await request("GET", "/v1/executions/missing/status");
  assert.equal(missing.status, 400);
  console.log("KERNEL_GATEWAY_TEST: PASS");
} finally {
  try { process.kill(-child.pid, "SIGTERM"); } catch {}
  await new Promise((resolve) => setTimeout(resolve, 100));
}
