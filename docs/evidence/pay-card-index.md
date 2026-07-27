# Recovered Pay/Card evidence index

This file was recovered from historical commit `c20beda`. Pay and Merchant
claims below are cross-product context only and are not owned, modified or
accepted by the 06 Card worktree.

## Current Card evidence

Source commit: `bdd5ca02ad42b712db66a5173ecfad09340aa42c`

- `go test ./internal/cardproduct/...` passed, including lifecycle, provider
  replay, Gateway replay/cross-product rejection, persistence, tamper and
  dependency-readiness tests.
- `npm test` in `apps/card` passed 8/8.
- `npm run typecheck` passed.
- `npm run bundle-check` exported Android and iOS Hermes bundles.
- `npm run security-check` found no signing material, private-key/token pattern,
  hard-coded Gradle password or PAN-like literal in the scoped Card sources and
  contracts.
- Android native release assembly is unverified: three MCP executions returned
  upstream `502` without a Gradle result.
- No current APK/IPA hash, native install, cold-start, central integration,
  staging, public deployment, hosted download, production signature or store
  release is claimed.

## Historical cross-product evidence only

- Historical Pay, Merchant and Card candidate reports described repository tests,
  Android release assembly and older APKs. Those reports predate the current
  Card-only recovery and signing-hardening checkpoint.
- `internal/payproduct/proof/live-testnet-payment.json`, where present in the Pay
  owner worktree, applies to an older Pay build and is not Card evidence.
- Earlier screenshots and Card runtime captures predate the current canonical
  Wallet/UI and are not current install proof.

## Current failure and blocker evidence

- The legacy repository-wide secret scan printed a pass while `rg` was missing;
  that output is rejected as evidence. Card uses its own zero-dependency gate.
- Official issuer sandbox selection, provider agreement and sandbox credential
  remain unresolved, while autonomous adapter/conformance work remains open.
- Central Wallet/Gateway acceptance, Data Fabric events, Trust dispute handoff,
  shared Testnet integration, native install evidence and secure signing remain
  incomplete.
