# YNX Chain

YNX Chain is a Web4 L1 blockchain ecosystem built around YNXT. The project is designed to grow from a verifiable local devnet and public testnet deployment package into a full-stack blockchain ecosystem with EVM-compatible RPC, multi-validator infrastructure, resource-based economics, AI-native services, Pay APIs, Trust tracing, developer tooling, wallet integration, explorer infrastructure, and global ecosystem readiness.

YNXT is the native coin and gas/resource asset of YNX Chain. YNX is the chain and brand name only.

Current repository scope includes engineering implementation, local devnet verification, public testnet deployment tooling, remote deployment safeguards, RPC/EVM RPC surfaces, faucet, indexer, explorer, AI Gateway, Pay API, Trust tracing, resource economy, Chain Law / Anti-Illegal Request architecture, developer tooling, SDKs, and readiness packages for wallets, exchanges, custody providers, stablecoin issuers, bridges, grants, and mainnet review.

This repository does not claim that YNX Chain has already launched mainnet, achieved exchange listing, obtained stablecoin issuer support, secured wallet default support, or formed third-party partnerships. Those require independent review, live public evidence, and external approval.

The goal is full-ecosystem readiness without fake claims.

Run `make setup`, `make test`, and `make smoke-test` to verify the local chain/API loop. Run `make env-check`, `make no-placeholder-check`, `make secret-scan`, and `make preflight` before deployment.

Real deployment values are intentionally not committed. Fill `ENV_INTAKE_FORM.md`, create local `.env` files ignored by git, then run `make deploy-testnet`, `make remote-smoke-test`, `make verify-testnet`, and `make public-proof`.
