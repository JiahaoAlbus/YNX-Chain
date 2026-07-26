# YNX Testnet Guide

| Field | Value |
| --- | --- |
| Version | 1.0.0-candidate |
| Effective date | 2026-07-22 |
| Evidence source commit | `719e1018267ed5a53e6fae5211c5fd8a1503c35c` |
| Product release | YNX Testnet documentation candidate |
| Last reviewed | 2026-07-22 |
| Superseded version | None |
| Canonical | `https://ynxweb4.com/testnet` |
| Title | YNX Testnet Guide — Network Identity, Wallet Setup and Safety |
| Meta description | Use YNX Testnet safely with EVM Chain ID 6423, YNXT Testnet assets, evidence checks and clear public-service limitations. |
| H1 | YNX Testnet Guide |

## Direct answer

YNX Testnet is the YNX Chain testing network. It uses EVM chain ID 6423
(`0x1917`), Comet/Cosmos chain ID `ynx_6423-1`, and YNXT as its native Testnet
asset. Testnet assets have no represented monetary value or guaranteed liquidity.

## Verify before connecting

| Field | Expected value |
| --- | --- |
| Network name | YNX Testnet |
| EVM chain ID | 6423 |
| Hex chain ID | `0x1917` |
| Native asset | YNXT |
| Decimals in network metadata | 18 |
| Official domain | `https://ynxweb4.com` |

Verify endpoint identity, TLS, chain ID, block progress, release version and
freshness. The currently published metadata lists EVM RPC, Explorer and Faucet
subdomains, but this documentation audit has not independently refreshed every
service endpoint. Treat a failed or unverified endpoint as unavailable.

## Wallet safety

Use an isolated Testnet account. Never enter a seed phrase or private key into a
website, support message, AI prompt or documentation form. A custom-network
request should add or switch only the expected chain and recheck the selected
chain. Adding a network must not request an account or transaction automatically.

Review recipient, amount, exact fee, nonce, chain ID and transaction hash before
signing. An unknown outcome is not success: search authoritative state by hash,
sender and nonce before considering another submission.

## Obtaining Testnet YNXT

A Faucet must validate the destination, report rate limits and return an actual
transaction/evidence result. A Faucet UI response alone is insufficient. If the
public Faucet is unavailable or unverified, do not use an unofficial provider or
claim funding succeeded.

## Developer use

The source includes Hardhat, Foundry, SDK and contract-verification workflows.
Compatibility is bounded to tested methods and artifacts; it does not imply
universal Ethereum compatibility. Do not publish a token or contract address
until chain identity, bytecode, source, decimals, symbol and authority are
verified.

## Finality and derived services

Committed chain state is authoritative. Explorer and Indexer records are derived
and may lag, rebuild or be unavailable. A wallet or service should expose
pending, committed, failed and unknown separately and should identify source and
observation time.

## Bridge and stablecoin warning

No live Bridge or official stablecoin route is claimed. The local Bridge
coordinator has external execution disabled, and the stablecoin service records
non-executing review intents only. Do not send value to an unapproved bridge or
stablecoin contract.

## Testnet versus Mainnet

Testnet code, balances, validators, packages and endpoints do not establish
Mainnet. Production signing, custody, economic policy, legal review, public
capacity and independent security evidence require separate release records.

## Troubleshooting

- Wrong chain ID: stop; do not sign or submit.
- Endpoint unavailable: show failure and retry later; do not fabricate health.
- Stale Explorer: compare authoritative RPC and source freshness.
- Faucet rejected: preserve reason/rate-limit state; do not claim a transaction.
- Unknown transaction: search by hash and sender nonce before retrying.
- Suspicious request for secrets: stop and use the official support/security path
  once those URLs are published and verified.

## Related pages

- [What is YNX Chain?](/what-is-ynx-chain)
- [What is YNXT?](/what-is-ynxt)
- [YNX Wallet](/wallet)
- [YNX Developer](/developer)
- [YNX Security](/security)
- [FAQ](/faq)

## Change log

- 1.0.0-candidate (2026-07-22): Initial network identity, verification, Wallet,
  Faucet, developer, finality, Bridge/stablecoin, Mainnet and troubleshooting
  guide.
