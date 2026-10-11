# PrivateDAO Network Capability Matrix

This file is a human-readable mirror of
`packages/privatedao-runtime/src/networks.ts`. The runtime catalog is
authoritative and intentionally fails closed.

| Network | Runtime stage | Product exposure | Independent evidence |
|---|---|---|---|
| Solana Devnet | `available` | Current Kernel network; Payroll rows are separately marked `devnet_verified`. | Product-specific Solana evidence; do not generalize it to every product. |
| Solana Mainnet | `planned` | Agent discovery/invocation is externally runtime-verified; no general product Mainnet execution claim. | No new Mainnet execution performed by this workstream. |
| Ethereum Sepolia | `available` | Blind Verification and Record Verification are application-bound through the Kernel. | Real contract-write E2E in `packages/evm-verification/deployments/phase-2-e2e-ethereum-sepolia.json`, including wrong-chain, altered-proof, expiry, replay, and revocation checks. |
| Arbitrum Sepolia | `available` | Blind Verification, Record Verification, Treasury, Governance, and Sealed Auction have independent real Testnet E2E evidence through the Kernel. | `packages/evm-verification/deployments/phase-2-e2e-arbitrum-sepolia.json` and `organizational-arbitrum-sepolia.json`. |
| BNB Testnet | `available` | Blind Verification, Record Verification, Treasury, Confidential Payroll, Governance, and Sealed Auction have independent real Testnet E2E evidence through the Kernel. | `packages/evm-verification/deployments/phase-2-e2e-bnb-testnet.json` and `organizational-bnb-testnet.json`. |
| Base Sepolia | `available` | Blind Verification, Record Verification, Treasury, Governance, and Sealed Auction have independent real Testnet E2E evidence through the Kernel. | `packages/evm-verification/deployments/phase-2-e2e-base-sepolia.json` and `organizational-base-sepolia.json`; Builder attribution is a separate gate. |
| Robinhood Chain Testnet | `available` | Treasury, Governance, and Sealed Auction have independent real Testnet E2E evidence; verification and Payroll settlement remain gated. | `packages/evm-verification/deployments/organizational-robinhood-testnet.json` plus the capability matrix. |
| Tempo Testnet | `available` | Blind Verification and Record Verification are application-bound through the Kernel. | Real contract-write E2E in `packages/evm-verification/deployments/phase-2-e2e-tempo-testnet.json` on chain 42431. |
| Zcash Testnet | `available` | Payroll settlement has confirmed Zallet/Zebra Testnet evidence; other product rows remain Kernel policy-only. | Zcash payroll evidence and runtime artifacts; no EVM or bridge substitution is allowed. |
| Stellar Testnet | `available` | Shared Kernel/Horizon adapter is implemented for verification, payroll policy, treasury policy, governance, and auction workflows. Existing Stellar record-probe receipt is real; product write E2E remains gated until a dedicated signed XDR run is approved. | `packages/privatedao-runtime/src/stellar-network.ts`, `scripts/test-stellar-kernel.mjs`, and the existing record-probe evidence. |
| Hyperliquid Testnet | `available` | Blind Verification and Record Verification have independent HyperEVM Testnet evidence. Treasury, Payroll, Governance, and Auctions remain gated. | `packages/evm-verification/deployments/phase-2-e2e-hyperliquid-testnet.json`; this does not certify HyperCore native execution. |

An entry is not customer-executable merely because an adapter or RPC responds.
A network requires a real provider adapter, transaction lifecycle, finality,
receipt/reconciliation path, application binding, and independent tests before
discovery or UI may present the exact capability as supported. The generated
machine-readable registry is authoritative for product/capability evidence;
this document is the human-readable network boundary.

The read-only EVM RPC probe currently reaches all six configured testnets and
observes the expected chain IDs: Ethereum Sepolia, Arbitrum Sepolia, BNB
Testnet, Base Sepolia, Robinhood Testnet, and Tempo Testnet. This is provider
health evidence only; it does not upgrade any product capability to
`testnet_verified`.
