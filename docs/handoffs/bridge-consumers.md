# Bridge Consumer Handoff

This handoff is merge input for Wallet, Pay, Exchange, DEX, Finance, Explorer, Monitor, and Trust. It does not authorize edits to those product worktrees and does not claim central integration.

Consume `consumer-integration-manifest.json` and `consumer-lifecycle-vectors.json`. Products must fail closed when the provider route is unavailable, when the canonical Wallet/Gateway session is absent or expired, or when evidence does not reach `destination_confirmed`.

No browser, consumer product, AI component, or Wallet UI receives the Bridge service API key, relayer key, provider credential, signer, or unrestricted withdrawal authority. Quote and user review belong to Wallet. The local coordinator begins at a source-event observation and never signs the user's source transaction.

The current CCTP candidate is unavailable because YNX was not listed in the inspected Circle testnet contract-address reference on 2026-07-22. Consumers may show an unavailable route with the official reference and failure reason; they may not present a transfer button or successful route.
