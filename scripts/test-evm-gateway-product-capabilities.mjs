import assert from "node:assert/strict";
import { ViemEvmTransport } from "../packages/privatedao-runtime/src/evm-viem-transport.ts";

const signer = "0x1111111111111111111111111111111111111111";
const clients = {
  publicClient: {
    async getChainId() { return 84532; },
    async waitForTransactionReceipt() { return { status: "success", blockNumber: 42n }; },
    async estimateContractGas() { return 100000n; },
    async getGasPrice() { return 1n; },
  },
  walletClient: {
    async writeContract() { return "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; },
  },
};

const transport = new ViemEvmTransport(
  clients.publicClient,
  clients.walletClient,
  "base-sepolia",
  "84532",
  "testnet",
  "https://sepolia.basescan.org",
  "ETH",
  signer,
);

const baseIntent = (capability, payload) => ({
  context: { requestId: `test-${capability}`, idempotencyKey: `test-${capability}`, product: capability.startsWith("auction") ? "auction" : "governance", capability, actorId: "test", network: "base-sepolia" },
  payload,
  accounts: [],
});

const proposal = await transport.prepare(baseIntent("governance.proposal.execute", {
  kind: "contract-write",
  address: "0x9887bcfe7daad364202d5d3102de180c389ecb20",
  abi: ["function createProposal(bytes32,bytes32,uint64,uint64,uint256)"],
  functionName: "createProposal",
  args: ["0x" + "01".repeat(32), "0x" + "02".repeat(32), 100, 200, 1],
}));
assert.equal(proposal.signingMode, "server");
assert.deepEqual(proposal.requiredSigners, []);
assert.equal(proposal.unsignedPayload.account, signer);

const bid = await transport.prepare(baseIntent("auction.bid.commit", {
  kind: "contract-write",
  address: "0xcfb3e7af09f206614cf7a3cf8a93f92379c1c374",
  abi: ["function commitBid(bytes32,bytes32)"],
  functionName: "commitBid",
  args: ["0x" + "03".repeat(32), "0x" + "04".repeat(32)],
}));
assert.equal(bid.unsignedPayload.account, signer);

await assert.rejects(
  () => new ViemEvmTransport(clients.publicClient, clients.walletClient, "base-sepolia", "84532", "testnet", "https://sepolia.basescan.org", "ETH").prepare(baseIntent("governance.proposal.execute", { kind: "contract-write", address: "0x123", abi: [], functionName: "x", args: [] })),
  /EVM contract write requires a configured signer account/,
);

console.log("EVM_GATEWAY_PRODUCT_CAPABILITIES: PASS");
