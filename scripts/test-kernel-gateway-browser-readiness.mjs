import assert from "node:assert/strict";
import http from "node:http";

process.env.PDAO_KERNEL_EVM_BROWSER_ENABLED = "1";
process.env.PDAO_KERNEL_EVM_NETWORKS = "arbitrum-sepolia,robinhood-testnet,hyperliquid-testnet";
process.env.PDAO_HYPERCORE_API_ENABLED = "1";
process.env.PDAO_HYPERCORE_API_URL = "https://api.hyperliquid-testnet.xyz/info";

const { KernelGatewayService } = await import("./kernel-gateway-service.ts");
const service = new KernelGatewayService();
const server = http.createServer((request, response) => void service.handle(request, response));

function requestHealth(port) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path: "/healthz", method: "GET" }, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try { resolve({ status: response.statusCode, body: JSON.parse(body) }); } catch (error) { reject(error); }
      });
    });
    request.on("error", reject);
    request.end();
  });
}

try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const result = await requestHealth(port);
  assert.equal(result.status, 200);
  for (const network of ["arbitrum-sepolia", "robinhood-testnet", "hyperliquid-testnet"]) {
    const mode = result.body.networkModes.find((entry) => entry.network === network);
    assert(mode, `${network} health mode is missing`);
    assert.equal(mode.onchainAdapter, true, `${network} browser adapter is not attached to Kernel`);
    assert.equal(mode.ready, true, `${network} RPC-backed adapter is not healthy`);
    assert.match(mode.provider, /-browser$/);
  }
  assert.equal(result.body.evm.broadcastEnabled, false);
  assert.equal(result.body.hypercore.nativeReadAdapter, "privatedao-hyperliquid-core-testnet");
  assert.equal(result.body.hypercore.ready, true);
  assert.equal(result.body.hypercore.executionEnabled, false);
  console.log("KERNEL_GATEWAY_BROWSER_READINESS: PASS");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
