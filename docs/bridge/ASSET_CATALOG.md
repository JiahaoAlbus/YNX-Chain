# Bridge Asset Catalog

Status date: 2026-07-23.

`GET /bridge/assets` is the public, credential-free token allowlist derived from configured fail-closed route policies. It is not a token-list endorsement, deployed-contract registry, balance source, reserve proof, or execution API.

Every configured chain/asset has exactly one class:

- `testnet-stablecoin`
- `wrapped-test-asset`
- `ynxt-bridge-candidate`
- `other-testnet-asset-candidate`

The same chain/asset cannot be assigned conflicting classes or be canonical on one route and represented on another. A catalog entry identifies its canonicality and observation-only movement boundary: lock or burn on a source side, and mint or release on a destination side. These labels describe intended accounting semantics only; no contract call or asset movement is implemented.

Current entries are `availability=unavailable` and `externalExecutionEnabled=false`. Contract, symbol, decimals, and explorer URL are JSON `null`; contract verification is false; supply authority is `not-configured`; reserve evidence is only an operator reconciliation reference and not independent proof. Allowlisting permits a bounded coordinator intent record, not source submission, minting, release, liquidity, issuer support, or user availability.

Before an entry can become executable, it requires verified source and destination contracts, exact symbol/decimals metadata, explorer verification, token and route legal review, mint/burn or lock/release authority review, threshold signer custody, supply/reserve reconciliation, funded Testnet receipts, replay and double-mint/release testing, central Wallet/Gateway acceptance, and public incident/recovery evidence.
