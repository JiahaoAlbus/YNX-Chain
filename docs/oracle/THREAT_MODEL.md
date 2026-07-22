# YNX Oracle and Market Data threat model

## Executive summary

The control plane treats every provider, reporter, network hop, stored byte, consumer, and operator action as independently fallible or adversarial. A price is authoritative only after schema validation, reporter authentication, replay protection, freshness checks, robust aggregation, quality evaluation, and consumer-side rejection rules all succeed. A last-known value is never silently promoted to a current settlement value.

This document covers the Go 1.25 `net/http` service, its integrity-protected event store, the provider registry, and the Go consumer SDK. TLS termination, network ACLs, secure secret injection, independent reporter infrastructure, and Chain governance are deployment controls that are not proven by local source code.

## Assets

- Provider and reporter identity, public keys, status, weights, and permitted data rights
- Raw signed observations and server-assigned receipt times
- Immutable correction history, audit identity, and effective time
- Aggregation policy and its governance version
- Aggregated price, confidence, coverage, staleness, divergence, and lineage
- Event-store integrity key and reporter private keys
- Consumer decisions such as liquidation, funding, valuation, stablecoin risk, and payment quotes

Reporter private keys and the store integrity key are never accepted through chat, API responses, logs, or committed configuration. The service reads only the state integrity key from its process environment. Reporter private keys remain outside the service.

## Trust boundaries

1. Provider boundary: provider payloads and timestamps are untrusted. Ed25519 proves the registered reporter signed a payload; it does not prove the economic fact is correct.
2. Ingestion boundary: the service assigns `receivedAt`, enforces an exact schema, bounds the body, verifies nonce domain/hash/signature/identity, rejects non-increasing sequences, and limits each provider’s ingestion rate.
3. Registry/governance boundary: registry content is versioned operator input. A key, weight, coverage claim, license, or status change must be reviewed and audited outside the public write API.
4. Aggregation boundary: observations are rejected for source status, market/type/scale mismatch, staleness, future dating, duplication, robust deviation, or divergence. Arithmetic is overflow-safe.
5. Persistence boundary: state is atomically replaced, HMAC protected, and chained over immutable observation and correction events. An HMAC is corruption/tamper evidence, not confidentiality.
6. Consumer boundary: HTTP success alone is insufficient. Consumers must independently reject wrong schema/version/source, stale/future data, insufficient sources, low confidence/coverage, circuit breakers, failures, and malformed lineage.
7. Deployment boundary: TLS, proxy trust, network segmentation, process isolation, file permissions, key delivery, denial-of-service controls, and monitoring are external until deployment evidence proves them.

## Threats and controls

| Threat | Primary controls | Residual risk / required operation |
|---|---|---|
| Replay across product/network | Versioned nonce domain, reporter identity, strictly increasing sequence, immutable ID conflict checks | Reporter recovery must preserve or explicitly rotate sequence/key state through governance. |
| Payload tamper | SHA-256 payload hash plus Ed25519 signature | Compromised reporter key can sign false data; multi-source aggregation and emergency removal remain required. |
| Provider collusion | Minimum three independent sources, public weights, MAD rejection, cross-source divergence circuit breaker | Three legal entities can still share upstream infrastructure. Independence must be evidenced operationally. |
| Thin-market or flash manipulation | Liquidity-aware weights, outlier rejection, divergence cap, explicit limited-source failure | Liquidity inputs are provider claims until venue-specific adapters independently verify depth. |
| Depeg mistaken for bad data | Divergence and circuit breaker expose disagreement instead of pinning to par | Stablecoin policy must distinguish genuine depeg from source corruption using reserve and venue evidence. |
| Delayed/outage data | Maximum age, future-skew check, server receipt time, explicit stale last-good response | Provider-specific outage alerts and tested fallback routing remain operational requirements. |
| Numeric overflow | Big-integer weight threshold and divergence math; signed positive integer validation | Consumer languages must use integer/decimal types with the published scale. |
| Correction erases history | Append-only correction event retains original, reason, effective time, actor, and audit ID | Correction authorization/governance transport is intentionally not exposed until canonical operator auth is integrated. |
| Store edit or rollback | HMAC envelope, event chain, generation, backup/restore verification | An attacker with both state and integrity key can forge state. Key isolation and off-host immutable backups are required. |
| Request resource exhaustion | Server header/time limits, per-route body limit, strict JSON, provider token bucket | Edge connection/rate controls and measured load limits remain required before public deployment. |
| Internal information disclosure | Public errors hide cryptographic/provider details; no stack traces, paths, or secrets; structured IDs | Log sink access and retention must be controlled at deployment. |
| Browser/API abuse | CORS disabled, no cookies, no bearer token, CSP/frame/referrer/permissions headers | Public reads still need edge abuse controls. |
| SSRF or unsafe URL | Runtime has no user-directed outbound fetch; consumer base URL rejects credentials and remote plain HTTP | Future provider adapters must use hostname allowlists, bounded responses, redirect restrictions, and timeouts. |
| Unsafe value consumption | SDK requires exact schema, freshness, source count, confidence, coverage, no failure/stale/breaker, and valid hashes | Non-Go consumers must pass the same shared test vectors. |
| Governance capture | Versioned policy/registry, public quality/lineage, notice/appeal requirement in provider policy | On-chain or multisig governance and timelocks are pending central integration. |

## Security invariants

- No single provider observation can become an authoritative default settlement price.
- A response with `stale=true`, `circuitBreaker=true`, a failure string, insufficient sources, or low confidence must never be used for liquidation, settlement, mint/burn, withdrawal limits, or execution.
- Provider authentication never grants user asset authority or Wallet permissions.
- Reporter and state-integrity secrets never appear in provider registry responses.
- Corrections never overwrite or delete originals.
- Test fixtures remain under test files/testdata and are never loaded by default runtime configuration.
- The daemon fails startup when registry input or the state integrity key is missing or invalid.

## Required security verification before public deployment

- Fuzz strict decoding, observation verification, event-store restore, and aggregation boundaries.
- Run race tests, `govulncheck`, secret scan, SAST, dependency review, SBOM generation, container/artifact scanning, and a bounded DAST suite.
- Demonstrate reporter key rotation, sequence recovery, registry rollback, emergency pause, provider removal notice/appeal, and a compromised-reporter exercise.
- Prove TLS/proxy boundaries, non-public diagnostics, file permissions, secret manager delivery, log redaction, rate limits, alerts, backup isolation, RTO, and RPO.
- Simulate flash manipulation, thin market, depeg, three-provider collusion, clock skew, outage, delayed data, reorg, correction, and historical replay.
