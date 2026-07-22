# Bridge Threat Model

## Assets and trust boundaries

Protected assets are user funds, source-event uniqueness, destination issuance/release authority, relayer identities, service credentials, route limits, pause state, reconciliation evidence, audit history, and release provenance.

The canonical Wallet signs user source transactions. Consumer products and AI never receive account secrets, Bridge credentials, relayer keys, or withdrawal authority. `ynx-bridged` accepts observations and records local state; external submission is disabled. Relayers provide independent Ed25519 attestations, but the current local keys and process do not constitute production custody, HSM/MPC protection, or canonical-bridge security.

## Principal threats and controls

| Threat | Current control | Residual boundary |
| --- | --- | --- |
| Duplicate source event or replay | Global source-event index, exact idempotency, signed domain | No external-chain watcher proof |
| Conflicting source block | All accepted relayers must bind one block hash | Relayer independence not externally audited |
| Premature finality | Per-route confirmations and threshold of at least two | Finality policy needs chain-specific review |
| Double mint or release | One local finalization and lifecycle transition graph | No destination contract is connected |
| Stolen service credential | Constant-time check, no credential persistence/logging, consumer denial | API-key auth is not the final canonical Gateway integration |
| Single relayer compromise | Distinct keys and threshold quorum | Production signer/HSM/MPC ceremony absent |
| Excess exposure | Per-transfer, UTC-daily, user-outstanding, and provider/route-outstanding limits plus persistent pause | Limits need route-specific economic and legal approval |
| Large transfer rushed after proof | Persisted not-before time blocks local finalization after quorum | Delay does not replace destination signer review |
| State tamper | Full-state digest, semantic startup validation, hash-chained audit | Digest is not a keyed signature or independent database audit |
| False reserve claim | Source labels, evidence references, visible difference, no automatic healthy result | Operator reference is not independent proof |
| Supply-chain replacement | Trimmed deterministic builds, checksum manifest, SBOM, secret scan | Public signing/provenance service absent |
| Consumer credits too early | Shared vectors allow availability only at destination confirmation | Consumer branches are not centrally integrated |
| Provider outage or unsupported chain | Route remains unavailable and external submission disabled | No supported provider route exists |
| Request flood or credential probing | Per API-key/IP and public-IP rate limits, bounded bodies, request/error correlation IDs | Single-process limiter needs distributed replacement before HA scale |

## Emergency behavior

Pause rejects new transfer creation and local finalization while preserving reads, audit, evidence recording, and recovery visibility. Recovery cannot rewrite audit history or silently clear reconciliation difference. A public or funded route requires separate contract, signer, limit, incident, emergency-exit, and independent-review evidence.
