# Decisions

## 2026-07-27 — Capacity reservation authority

A reservation is authoritative only for the exact Offer referenced by the accepted Quote. Provider-level totals are retained as a derived aggregate, but they cannot be used to borrow capacity across sibling Offers.

## 2026-07-27 — Self-dealing

A Provider wallet cannot purchase its own fixed-price capacity or submit an auction bid when it is also the procurement buyer. These paths fail closed and expose `RESOURCE_SELF_DEALING_REJECTED` through the API contract.

## 2026-07-27 — Schema 6 migration

Pre-v6 snapshots derive Offer and Provider reservation ledgers solely from active orders with valid Quote→Offer lineage and persist the upgrade at startup. Once a snapshot is schema 6, ledger mismatch is treated as semantic tampering and startup fails closed; it is never silently repaired.

## 2026-07-27 — Release truth

Passing local tests, Race, Vet and cold-start smoke does not set central, staging, public, hosted, signed or store-release booleans. The product remains `ACTIVE` in `INTEGRATE`.
