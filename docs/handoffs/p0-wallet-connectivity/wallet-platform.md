# Wallet Platform Handoff

Inventory Android, iOS, macOS, Windows, web companion, extension, and DApp
Browser artifacts. Propose only client changes that consume accepted protocol
contracts. Include faucet, universal/app link, QR/deep-link loop, disconnected
state, EIP-6963 discovery, and individual artwork evidence.

## Faucet Public/Wallet Entry Points

- Website entry: `https://faucet.ynxweb4.com` (authoritative public faucet service).
- Public wallet deep-link placeholder: `ynxwallet://` transport exists for
  canonical `authorize` and `intent` payloads, but no dedicated wallet-only
  `faucet` deep-link is published for this product path in this slice.
- For production handoff, wallet apps should route users who request faucet funds
  to the website flow above and avoid local fake-success responses.
