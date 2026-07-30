# YNX Oracle and Market Data — Testnet Candidate Notes

## Current candidate — 2026-07-27

The candidate provides a signed, versioned Oracle control plane; strict scalar
and structured market-data contracts; robust multi-source aggregation; durable
integrity, correction, replay, migration, emergency controls, and observability;
Go and TypeScript consumer validation; a fail-closed consumer CLI; container
packaging; and an independent multilingual Oracle Web/PWA.

Consumer portability and release integrity advanced in three protected checkpoints:

- `6e811f74c3d68aa70d3216fea9682e932f9a3e73` adds the strict TypeScript SDK. It compiled successfully and passed 18 canonical-vector, schema, derivation, transport, and response-bound tests.
- `1d17e520186a500f5c9ab04ee88769637d88fc59` adds `ynx-oracle-cli`. Go race tests passed, and the CLI emits no price until market, type, policy version, freshness, confidence, coverage, lineage, and derivation checks pass.
- `7ba44cfbe66455884ac6c2ea8525e9738b7f1396` freezes the aligned Oracle candidate with deterministic macOS arm64 and Linux arm64 server/CLI bundles plus TypeScript and Go SDK candidates. Canonical manifest, SHA-256/bytes, target validation, CycloneDX SBOM, provenance, detached-signature verification, tamper rejection, clean SDK consumers, a real macOS install/cold-start/version-binding/graceful-shutdown drill, zero-high dependency audit, immutable Actions pins and real-Chrome accessibility passed.

A real limited-source public Testnet control plane is deployed at
`https://oracle-testnet.43.153.202.237.sslip.io` from deployment commit
`f71d5ca5c2ede28477fbadff36701a9f040e311f`. It intentionally reports degraded
health at 0/3 approved sources and publishes no authoritative price. This does
not make the current candidate deployed, hosted, production-signed, centrally
integrated, or released.

The Oracle Web remains owner-only and returns HTTP 401 to unauthenticated
requests. Current-commit server, CLI, and SDK candidates now have reproducible
local packaging, hashes, SBOM, provenance and macOS cold-start evidence, but
remain unsigned, unhosted and unreleased; Linux arm64 native cold start is open.

## Release boundary

This remains a `testnet-candidate`, not a final public Testnet release. Final
activation requires:

- at least three independent approved providers with confirmed benchmark,
  valuation, redistribution, and retention rights;
- secure reporter and state-integrity key custody;
- exact-commit acceptance from Chain, Exchange, DEX, Quant, Finance, Pay,
  Explorer, Monitor, Bridge, Gateway, Wallet/Auth, and Integration owners as
  applicable;
- public Oracle Web access and live API binding;
- current-commit artifact hashes, SBOM, provenance, signing class, installation,
  cold-start, restore, load, and failover evidence;
- Security/SRE and Integration release acceptance.

Every provider candidate remains inactive. Consumers must fail closed until the
three-source and quality policies are directly satisfied. Breaking and rollback
details are in `MIGRATION_COMPATIBILITY.md`; required external inputs are listed
without secrets in `release/operator-inputs.request.json`.
