# Threat model and security boundaries

## Assets and trust boundaries

Quant owns strategy source/artifact hashes, datasets and lineage, experiments,
paper state, lifecycle evidence, risk decisions, and execution requests. It does
not own Wallet keys, exchange withdrawals, DEX vault ownership, authoritative
chain state, settlement, or user funds.

Trust boundaries are: browser/desktop to App Gateway; Gateway to Quant API;
Quant to Wallet mandate introspection; Quant to Exchange/DEX adapters; worker
spool to deterministic engine; dataset/provider to catalog; and operators to
backup/signing/deployment systems.

## Primary threats and controls

| Threat | Current control | Remaining gate |
| --- | --- | --- |
| forged/widened/replayed mandate | exact strategy/market/limit/expiry binding, verifier interface, replay/idempotency tests | canonical Gateway and Wallet verifier integration |
| revoked or expired execution | persistent revocation and expiry checks before submit | remote revoke propagation drill |
| strategy escape or malware | worker accepts only signed schema-bound built-in packages; exact source/artifact hashes, scan evidence, dependency allowlist, deterministic limits, and zero host/network/key/secret permissions; no source execution | container/WASM sandbox for future user code |
| secret or Wallet-key exposure | no key fields or signing route; scanners; adapters receive bounded proof only | deployed secret manager and redacted telemetry test |
| state overwrite/tamper | integrity hash, atomic writes, cross-process lock, tamper tests | transactional database and replica failover |
| path/symlink attack on worker spool | fixed operator-configured roots, constrained job IDs, regular-file requirement | `openat`/no-follow hardening and container mount policy |
| API cross-origin abuse | loopback preview boundary and same-origin WebSocket check | canonical product/device/session auth for public writes |
| venue sequence/reconciliation failure | idempotency, broker proof, fresh-oracle/venue-health pre-trade gate, signed slippage/gas/frequency/loss limits, reconciliation-triggered kill switch | canonical risk feed and real adapter sequence/snapshot/retry tests |
| data leakage/look-ahead/survivorship | ordered timestamps, OOS split, deterministic hash, gap handling | full dataset catalog/correction/delisting corpus |
| dependency/build compromise | lockfiles, SBOM, notices, pinned build image, review scripts | CI provenance, SAST/DAST/container scan and signed artifacts |

Public deployment remains prohibited until canonical Auth/Gateway integration,
adapter sandbox evidence, artifact scanning/provenance, and incident monitoring
are directly verified.
