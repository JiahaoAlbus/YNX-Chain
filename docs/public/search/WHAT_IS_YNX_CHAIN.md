# What Is YNX Chain?

| Field | Value |
| --- | --- |
| Version | 1.0.0-candidate |
| Effective date | 2026-07-22 |
| Evidence source commit | `719e1018267ed5a53e6fae5211c5fd8a1503c35c` |
| Product release | YNX Testnet documentation candidate |
| Last reviewed | 2026-07-22 |
| Superseded version | None |
| Canonical | `https://ynxweb4.com/what-is-ynx-chain` |
| Title | What Is YNX Chain? Web4 Layer-1 Ecosystem Explained |
| Meta description | YNX Chain is a Web4 Layer-1 ecosystem. Learn its Testnet identity, architecture, products, evidence model and current limitations. |
| H1 | What Is YNX Chain? |

## Direct answer

YNX Chain is a Web4 Layer-1 ecosystem under Testnet engineering. It combines an
accepted consensus/application baseline, EVM-oriented network interfaces, native
signed transactions and independent application candidates. YNX Web4 is the
application ecosystem powered by YNX Chain, and YNXT is the native Testnet asset.

## Definition

“Web4” is a YNX product term for user-controlled accounts, permissioned
applications, verifiable execution, evidence-linked automation and explicit
human approval. It is not presented as an adopted Internet standard.

## Network identity

| Item | Value |
| --- | --- |
| Testnet | YNX Testnet |
| Native Testnet asset | YNXT |
| EVM chain ID | 6423 (`0x1917`) |
| Comet/Cosmos chain ID | `ynx_6423-1` |
| Official domain | `https://ynxweb4.com` |

## How the architecture is organized

The accepted consensus baseline uses CometBFT with a deterministic YNX ABCI
application. A newer StreamBFT implementation exists only as a disabled local
shadow candidate; the public network is not claimed to run it.

Authoritative account, transaction and application results come from committed
state. Wallet identity and approval come from the canonical Wallet/Auth path.
Indexes, explorers, providers, caches, estimates and AI outputs are bounded
sources and cannot silently replace those authorities.

## What belongs to YNX Web4?

YNX Web4 is designed as a portfolio of independent products, including Wallet,
Pay, Explorer, Developer, Exchange, DEX, Quant, Trust, Resource, Cloud and other
application candidates. A common account or design language does not turn them
into one super-app. Each product requires its own scopes, workflow, evidence and
release record.

## Current status

The repository contains locally tested components, deployment tooling,
operator-controlled observations and product candidates. These are not
equivalent to public deployment, production signing or store release. Current
independent endpoint proof for all service subdomains remains incomplete.

## Risks and limits

- YNXT is a Testnet asset with no represented monetary value or guaranteed
  liquidity.
- Mainnet, final allocation, staking returns, stablecoin reserves, live Bridge,
  production custody and exchange liquidity are not implied.
- Security, economic and legal review remains incomplete where stated.
- Component status can change; use the exact release record and evidence date.

## Evidence

The technical whitepaper, StreamBFT specification, economics disclosures,
evidence index and machine-readable release record define the current claim
boundary. A screenshot or source directory alone is not release proof.

## Related pages

- [What is YNX Web4?](/what-is-ynx-web4)
- [What is YNXT?](/what-is-ynxt)
- [YNX Testnet Guide](/testnet)
- [YNX Security](/security)
- [YNX Economics](/economics)
- [YNX Products](/products)
- [FAQ](/faq)

## Change log

- 1.0.0-candidate (2026-07-22): Initial evidence-linked definition, architecture,
  product, status, risk and navigation page.
