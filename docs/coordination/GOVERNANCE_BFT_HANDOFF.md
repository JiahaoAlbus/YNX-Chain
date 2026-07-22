# Governance BFT handoff

Chain Core owns consensus action registration, signature verification, account nonce consumption, deterministic AppHash, transaction inclusion, and block receipts. Governance owns lifecycle rules, payload schemas, policy bounds, vote/delegation rules, role scope, emergency limits, and receipt validation.

The machine contract is `release/integration/governance-bft.manifest.json`; required negative and determinism vectors are in `governance-bft-test-vectors.json`.

Do not map local `executing`, `executed`, or `rolled_back` state to a public protocol claim without a receipt whose transaction, block, state root, manifest, source, version, outcome, timestamp, and audit hash all validate. The local daemon reports `externalExecution=false` until Chain Core integration and real Testnet receipt evidence exist.

Acceptance requires deterministic execution across at least four application instances, replay and tamper rejection, restart persistence, exact release identity, Explorer lookup, Monitor observation, and a rollback drill. Current manifest status remains false for Chain Core implementation and Testnet observation.
