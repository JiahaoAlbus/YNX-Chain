# P0 Wallet Connectivity Coordination Protocol

Campaign: `P0-WALLET-CONNECTIVITY-2026-08`

This directory is the sole central control plane for the campaign. Only the
`integration` owner may change central registry, ownership, path-lock, release
truth, endpoint, acceptance, or retirement records. Product owners may change
only their source, tests, evidence, handoff, and proposal files.

## Safety rules

- Standard wallet connection is a base layer. It remains available when Central
  Gateway, Data Fabric, Monitor, or a private product API is unavailable.
- Product Session is an optional first-party enhancement. Failure is reported
  as `DEGRADED_PRODUCT_SESSION`; it must never create a local session or change
  a standard connection into an offline failure.
- A consumer may activate only an `ACCEPTED` entry in `contract-registry.json`.
  A product owner may submit only `CANDIDATE` evidence through `proposals/`.
- A path lock is required before touching a product path. Cross-owner changes
  require a proposal with reproduction, expected contract, test vector, and
  blocking reason.
- Public, installed, and production claims require exact source, artifact, and
  runtime identity. Local evidence is not public evidence.

## Current campaign boundary

P0 freezes independent YNX ID work, non-essential new products, extra finance
features, and Shop Android. It prioritizes wallet transport, release endpoint
truth, installed-client connectivity, and individual application artwork.

## Proposal lifecycle

`DRAFT -> CANDIDATE -> ACCEPTED | REJECTED | SUPERSEDED`

An accepted contract has an owner, version, schema version, source commit,
vectors, consumer list, compatibility statement, migration, and rollback path.
