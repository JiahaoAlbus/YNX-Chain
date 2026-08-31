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

| Product | Public evidence | Source checkpoint that is **not** bound by this evidence | Result |
| --- | --- | --- | --- |
| Finance | `/health` — HTTP 200, JSON, 485 bytes, SHA-256 `d1e97a4314acd1ecccf94629d15bd598cb58ff78136b3622ac26d583a82e45c1`; `/version` — HTTP 200, JSON, 130 bytes, SHA-256 `39789776da47e60b7a7df845789e02ebba16707ad8951eb6f27c84c1b40bb226`, commit `3b2383f5c18ab3eb5ce7f7f6a267d2cfe7c7e6a4`, release `ynx-finance-3b2383f5c18a`. | `codex/final-finance-suite` / `62a2c942d27a1d9b560e6696530b34dc26467f79` (and the separately prepared Finance runtime candidate). | Public runtime is old/unbound; no Wallet, portfolio, lending, yield, or action claim. |
| DEX | `/health` — HTTP 200, JSON, 238 bytes, SHA-256 `20a96d0ac7dede526b2b37bea77dccc430b9d3cf32372fd2b038e733c38567a3`; response identifies chain `6423`, latest block `956758`, and indexed state. `/version` — HTTP 200, JSON, 126 bytes, SHA-256 `da7de848ab2f74dfdb15b0f00f11dbba9b7cf95223abd7137d21ea9d35433296`, commit `ac775de24176b293b5dbb5ab7114cf29428f8046`, release `ynx-dex-ac775de24176`. | `codex/dex-c7-four-path-manifest-20260831` / `4b3ca5380adda12b4a0a871a9b642b1fc8a8ac37`. | The indexed health response is observable, but it is not the current source checkpoint and cannot prove swap, approval, liquidity, custody, or Wallet behavior. |
| Exchange | `/health` — HTTP 200 but `text/html`, 18,603 bytes, SHA-256 `64c5b7862099eb06a316fbc6d1c665e81355f427fa27b26584bbf586ac4eacde`; bounded `/version` read timed out during TLS before a body was obtained. | `codex/exchange-a9-runtime-carrier-20260831` / `2f1b0f8bc08e2abedcf27bf9c2af902e49da4618`. | Health route is an HTML fallback, not a source-bound API health response. No market-stream, order, match, settlement, or Wallet claim. |
| Quant | `/health` — bounded TLS connection timeout; `/version` — HTTP 404, plain text, 19 bytes, SHA-256 `b16e15764b8bc06c5c3f9f19bc8b99fa48e7894aa5a6ccdad65da49bbf564793`. | `codex/quant-owner-contract-snapshot` / `5863ddc6a02c0069628fe4d6e8f831f260303271`. | No public runtime/version contract was found. No strategy, backtest, paper/Testnet execution, or Wallet claim. |

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
