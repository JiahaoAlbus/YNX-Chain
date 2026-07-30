# YNX Developer

| Field | Value |
| --- | --- |
| Version | 1.0.0-candidate |
| Effective date | 2026-07-22 |
| Evidence source commit | `719e1018267ed5a53e6fae5211c5fd8a1503c35c` |
| Product release | YNX Testnet documentation candidate |
| Last reviewed | 2026-07-22 |
| Canonical | `https://ynxweb4.com/developer` |
| Title | YNX Developer — Build on YNX Testnet |
| Meta description | Build on YNX Testnet with chain ID 6423, YNXT, EVM-oriented RPC, Hardhat, Foundry, SDKs and evidence-bound deployment. |
| H1 | Build on YNX Testnet |

## Direct answer

YNX Developer covers the Testnet RPC, SDK, contract, verification and IDE
engineering surfaces. YNX Testnet uses EVM chain ID 6423 and YNXT. Compatibility
is bounded to directly tested methods and artifacts, not every Ethereum tool or
opcode.

## Start safely

Verify network name, chain ID, endpoint TLS, release identity and block growth.
Use Testnet-only accounts and environment-provided deployer credentials. Do not
commit keys or rely on generated/default production credentials.

The source provides Hardhat and Foundry configuration, JavaScript and Python SDK
guidance, network helpers and contract-verification workflows. Generated Solidity
artifacts are a required precondition for bounded IDE/consensus tests in a clean
checkout.

## Contract publication gate

Before publishing an address, verify chain ID, on-chain bytecode, source/compiler
settings, constructor arguments, decimals, symbol, authority and deployment
transaction. The canonical token list remains empty until actual token contracts
satisfy that gate.

## Wallet and AI

Deployments require canonical Wallet review and signature. A developer tool or AI
may draft code, tests or a patch but cannot hold user keys or deploy without
explicit approval. Provider and model state, context consent, cost, preview,
apply/reject and audit remain visible.

## Current status

Local tooling and product candidates exist. Public IDE deployment, complete
Wallet integration, signed macOS/Windows distribution, independent audit and
public capacity require separate evidence.

## Related pages

- [YNX Testnet Guide](/testnet)
- [YNX Wallet](/wallet)
- [YNX Security](/security)
- [What is YNX Chain?](/what-is-ynx-chain)
- [FAQ](/faq)

## Change log

- 1.0.0-candidate (2026-07-22): Initial network, tooling, contract, Wallet/AI,
  status and safety page.
