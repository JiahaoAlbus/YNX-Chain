# Wallet Web EIP-6963 owner handoff — 2026-08-21

## Frozen source

- Branch: `codex/wallet-extension-eip6963-p0-20260821`
- Implementation commit: `7a8b232b2e7c1fa88f15639deb90c7bac6ec87ec`
- Tree: `ffe6dc3a9ab43bd569a8ae23e907d8342b4ae25e`
- Base: `4da26d1a743154e03751734a0421bf9eb4069860`

## Change

EIP-6963 discovery now accepts only complete standard provider metadata, snapshots
that metadata immutably, and removes a UUID entirely when two conflicting provider
announcements claim it. A later event cannot replace an already-announced provider.

The slice is compatible with the accepted Standard Wallet contract `66003e76`, SDK
contract `203be5e1`, and canonical error contract `24cc3218`; it does not alter
Wallet Protocol, Gateway, Product Session, Card, or Finance.

## Verification

- `node --test test/*.test.js`: 91/91 passed.
- `node scripts/build.mjs`: passed.
- `node scripts/verify-package.mjs`: three fail-closed artifact packages verified.
- Structured evidence: `release/integration/wallet-web-eip6963-provider-collision-evidence-20260821.json`.

## Boundary

No browser-installed Extension, visible EIP-6963 discovery, WalletConnect pairing,
real provider connection, account authorization, signature, transaction, public
deployment, hosted download, production signing, or ComputerControl assertion is
made by this source-only slice. Those states remain false pending direct evidence.
