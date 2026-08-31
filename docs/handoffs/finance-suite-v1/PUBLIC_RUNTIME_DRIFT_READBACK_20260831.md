# Finance suite public-runtime drift readback — 2026-08-31

Status: read-only public HTTPS evidence. This document is **not** a deployment
receipt, a Wallet lifecycle result, a signed-action result, or a Testnet
execution result.

## Method and boundary

A bounded unauthenticated `curl` read was made from the owner workstation to
each product's public `health` and/or `version` route. No SSH, deploy,
service/configuration mutation, Wallet click, account request, signature, or
transaction occurred. A reachable HTTPS route establishes only the response
recorded below; it does not bind a running process to an owner source commit.

## Current public observations

Refreshed at `2026-08-31T10:17:26Z`. Response byte counts and hashes below
are exact direct HTTPS reads from that observation; they are not inferred from
local source or a previous release receipt.

| Product | Public evidence | Source checkpoint that is **not** bound by this evidence | Result |
| --- | --- | --- | --- |
| Finance | `/health` — HTTP 200, JSON, 485 bytes, SHA-256 `d1e97a4314acd1ecccf94629d15bd598cb58ff78136b3622ac26d583a82e45c1`; `/version` — HTTP 200, JSON, 130 bytes, SHA-256 `39789776da47e60b7a7df845789e02ebba16707ad8951eb6f27c84c1b40bb226`, commit `3b2383f5c18ab3eb5ce7f7f6a267d2cfe7c7e6a4`, release `ynx-finance-3b2383f5c18a`. | `codex/final-finance-suite` / `605e234fb8b96c30a8b9fef248e5d19a55f48bf3`. | Public runtime is old/unbound; no Wallet, portfolio, lending, yield, or action claim. |
| DEX | `/health` — HTTP 200, JSON, 238 bytes, SHA-256 `20a96d0ac7dede526b2b37bea77dccc430b9d3cf32372fd2b038e733c38567a3`; response identifies chain `6423`, latest block `956758`, indexed state and `executionAvailable=true`. `/version` — HTTP 200, JSON, 126 bytes, SHA-256 `da7de848ab2f74dfdb15b0f00f11dbba9b7cf95223abd7137d21ea9d35433296`, commit `ac775de24176b293b5dbb5ab7114cf29428f8046`, release `ynx-dex-ac775de24176`. | `codex/dex-c7-four-path-manifest-20260831` / `a55441fd43c61431228fdf71f93933640bedcf9d`. | The indexed health response is observable, but it is not the current source checkpoint. Its legacy `executionAvailable=true` field is not product-owned Swap, approval, liquidity, custody, Wallet, or Strategy Vault v1.35 evidence. |
| Exchange | `/health` and `/version` both return the same HTTP 200 `text/html` fallback, 18,603 bytes, SHA-256 `64c5b7862099eb06a316fbc6d1c665e81355f427fa27b26584bbf586ac4eacde`. | `codex/exchange-a9-runtime-carrier-20260831` / `2f1b0f8bc08e2abedcf27bf9c2af902e49da4618`. | No source-bound API health/version route is exposed. No market-stream, order, match, settlement, or Wallet claim. |
| Quant | `/api/health` — HTTP 200, JSON, 296 bytes, SHA-256 `3ddf5e35912c65a9e0565b35a6fa5d4b295602a2054d6d9cea9fefff17f414c1`; `/api/version` — HTTP 200, JSON, 108 bytes, SHA-256 `6451c911ec4ef12cf7c47f5611f7c5fcce1f319c81a69427941c65b78b563556`, both commit `443286487e057d78cb6b1a686d14bb37be8b3c23`. | `codex/quant-owner-contract-snapshot` / `5863ddc6a02c0069628fe4d6e8f831f260303271`. | The API is observable but is not source-bound to the owner checkpoint. It reports `simulated_testnet_only`; no strategy, backtest, paper/Testnet execution, or Wallet claim follows. |

## Required central follow-up

1. Finance: issue a new single-use deployment lease only after a fresh
   rollback-first preflight binds the current host, candidate artifact, and
   public verifier. Earlier consumed leases are not reusable.
2. DEX: bind a product-owned release artifact to a new DEX-only deployment
   lease, then prove the current source, public health/version and separately
   verify Testnet write paths under the Strategy Vault v1.35 boundary.
3. Exchange: correct the public API/runtime routing and bind a source version
   before testing SSE/order/matching behavior with an independent deployment
   lease.
4. Quant: provide a source-bound public `/health` and `/version` runtime under
   its own lease before any provider or strategy lifecycle evidence is sought.

Until those product-specific gates complete, all public, installed, Wallet
approval, Product Session, signature, transaction, liquidity, order, and
strategy-execution flags remain false.
