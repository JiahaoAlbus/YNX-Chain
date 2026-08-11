# YNX Video service

`internal/video` is the persistent orchestration boundary for YNX Video and
Creator Studio. It atomically stores HMAC-protected state and a SHA-256-linked
audit log, bounds private media objects by item and account quota, fails closed
when scanning is unavailable, and invokes real FFmpeg HLS processing. Interrupted
scan/transcode jobs become explicit retryable failures after restart. Creator Studio
adds channel-owned team roles with immediate revocation, source-bound rights
declarations with independent review, and commercial eligibility that fails closed
unless rights remain verified.

Production startup requires environment-only secrets:

```sh
YNX_VIDEO_DATA=/var/lib/ynx-video \
YNX_VIDEO_INTEGRITY_KEY='<at-least-32-byte-secret>' \
YNX_WALLET_GATEWAY_URL='https://wallet-auth.ynxweb4.com' \
YNX_VIDEO_SCANNER=clamscan \
YNX_VIDEO_FFMPEG=ffmpeg \
YNX_VIDEO_MODERATORS='ynx1...' \
go run ./internal/video/cmd
```

The loopback `video-smoke` requires the configured moderator set to include
`ynx1zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zcrwn4`. It exercises a repository-owned
media flow through team invite/accept, editor upload, exact source-hash rights
declaration, creator self-review rejection, independent review, publication,
team revocation and post-revocation denial. A missing or unhealthy scanner is a
hard failure; the smoke never substitutes a mock scanner or synthetic revenue.

## Wallet and Gateway boundary

The daemon does not accept a source-controlled or operator-created
`token=account` map. The central Gateway verifies the exact
`packages/wallet-auth` v1 approval and product-device challenge. Web, Android
and iOS retain the non-exportable P-256 device key and short-lived Product
Session across a normal product restart. Every protected request creates a
fresh `YNX_PRODUCT_SESSION_HTTP_PROOF_V1`; the service derives the required
scope, calls canonical introspection, and checks the exact product, client,
bundle, account and expiry. Cross-product reuse, stale requests and replay fail
closed. Guests can discover, search, watch and read comments on published
content without a Wallet.

Registered product contracts:

- `ynx-video-mobile-v1` / `com.ynxweb4.video`
- `ynx-video-web-v1` / `com.ynxweb4.video.web`
- `ynx-creator-studio-web-v1` / `com.ynxweb4.creator-studio.web`

The public Testnet viewer and Creator Studio use the same-origin API route
`https://web4.ynxweb4.com/video/api`. Their registered Wallet callbacks are
`https://web4.ynxweb4.com/video/wallet-auth/callback` and
`https://web4.ynxweb4.com/video/studio/wallet-auth/callback` respectively.

Both Video registrations and Creator Studio are approved and enabled in the
central source registry and reviewed by Wallet tests. The service still fails
closed until a valid canonical Product Session proof is introspected. Public
deployment of this current source remains a separate release gate.

## External services

- `YNX_VIDEO_AI_GATEWAY` and `YNX_VIDEO_AI_TOKEN` enable bounded summary,
  chapters, captions, metadata, search assistance, and moderation-explanation
  proposals. Every run records output language, context, permission, provider,
  model, cancel/retry, human accept/reject, deletion, and audit. Acceptance does
  not publish, claim rights, take down, penalize, or enable monetization.
- `YNX_VIDEO_PAY_ENDPOINT` and `YNX_VIDEO_PAY_TOKEN` use the accepted central
  `/pay/intents` and `/pay/invoices/{id}/settlement` contracts. Revenue is
  accepted only from matching paid YNXT evidence with intent/invoice, payout
  address, amount, transaction hash, block height, and audit hash. A creator
  payout record remains `awaiting_wallet_confirmation`; it is never called a
  completed payout locally.
- Trust decisions remain at the signed central `/trust/appeals` boundary. This
  service persists reports, takedown notices, creator appeals, reviewer
  separation, and explanations, but does not submit a Trust chain action using
  a product service signer on behalf of a creator. That per-user delegated
  signer contract is an explicit external integration blocker.
