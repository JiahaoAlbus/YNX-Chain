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

## Current Faucet Runtime Handoff

- The public website flow is verified on `ynx-chain-64efa498fa99`: health is
  live on chain `6423` / `0x1917`, 0x recipient claims are real Testnet
  transfers, and duplicate claims receive `429` without a second transfer.
- The authoritative public faucet currently returns `400 invalid address` for
  the tested `ynx1...` form. Do not advertise native-address claim support in
  Wallet UI until Wallet Protocol and Faucet contracts agree on normalization
  and the production path has evidence.
- Explorer transaction-page lookups currently return `404`; Wallet clients may
  show the RPC-confirmed transaction hash but must not claim an Explorer page
  is available until the Explorer Owner publishes that route.
