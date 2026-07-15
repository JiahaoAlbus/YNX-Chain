# YNX AI Client

YNX AI is a separate Web client for the permissioned `ynx-ai-gatewayd`. Provider
credentials remain server-side. Provider failure is rendered as failure; this
client contains no fallback answer generator.

## Security and product boundaries

- Sign in uses a five-minute, single-use YNX Wallet challenge bound to chain
  `ynx_6423-1`, EVM chain ID `6423`, product, exact callback, device public key,
  and least-privilege scopes. Account and device signatures are both required.
- Conversation bodies are encrypted with AES-256-GCM. The state file contains
  metadata, authenticated ciphertext, token hashes, permission/action records,
  appeals, deletion state, and a linked audit chain; it never stores Wallet or
  provider private material.
- Tool, action, and chain-action proposals stop at explicit review. Approval is
  recorded as `approved_not_executed`. Chain actions still require a separate
  YNX Wallet transaction review and signature.
- Provider quota and actual token usage are currently not returned by the
  Gateway. The client says `quota unknown` and labels token, resource, and money
  values as estimates. Money remains unknown unless operator-supplied provider
  rate metadata is configured.

## Run locally

Copy the values from `.env.example` into your secret runtime environment; do not
commit them. Then:

```bash
go run ./apps/ai
```

Open `http://127.0.0.1:6438`. A local YNX Wallet or compatible test signer must
return both proofs shown by the sign-in request.

## Checks

```bash
bash apps/ai/scripts/smoke.sh
```

This runs focused auth, encryption, persistence, provider-failure, approval and
deletion tests; validates browser JavaScript; builds the product binary; cold
starts it; and checks the embedded Web surface and product metadata.

The browser package identifier is `com.ynxweb4.ai`; the exact Wallet callback is
`ynx-ai://com.ynxweb4.ai/auth/callback`.
