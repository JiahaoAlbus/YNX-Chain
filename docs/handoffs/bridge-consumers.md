# Bridge Consumer Handoff

This handoff is merge input for Wallet, Pay, Exchange, DEX, Finance, Explorer, Monitor, and Trust. It does not authorize edits to those product worktrees and does not claim central integration.

Consume `docs/bridge/consumer-integration-manifest.json`, `docs/bridge/consumer-lifecycle-vectors.json`, `release/integration/ynx-bridge-contract.json`, and `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`. Products must fail closed when the provider route is unavailable, when the canonical Wallet/App Gateway session is absent or expired, when the runtime contract is not schema `7` / state machine `ynx.bridge.lifecycle.v1`, or when evidence has not reached `destination_available` with `destinationAssetAvailable=true`.

`destination_mint_release_confirmed` is only destination transaction confirmation. It is not a spendability or deposit-credit signal. Pay and Exchange must keep the transfer pending at that state. Provider webhook status is never source finality, proof verification, destination confirmation, or destination availability.

No browser, consumer product, AI component, or Wallet UI receives the Bridge service API key, relayer key, provider credential, signer, or unrestricted withdrawal authority. Quote and user review belong to Wallet. The local coordinator begins at a source-event observation and never signs the user's source transaction.

The implemented verifier covers domain-separated threshold-relayer attestations. It is not a light client, not independent consensus verification, not a canonical Bridge, and not a trustless Bridge.

The current official stablecoin candidate remains unavailable because no verified YNX provider route, verified source/destination Bridge contracts, provider credential/agreement, or public deployment evidence is present. Consumers may display an unavailable route and its failure reason; they may not present an executable transfer or successful outcome.
