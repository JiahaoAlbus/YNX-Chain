# YNX Video service

`internal/video` is the persistent orchestration boundary for YNX Video and
Creator Studio. It atomically stores HMAC-protected state and a SHA-256-linked
audit log, bounds private media objects by item and account quota, fails closed
when scanning is unavailable, and invokes real FFmpeg HLS processing. Interrupted
scan/transcode jobs become explicit retryable failures after restart.

Production startup requires environment-only secrets:

```sh
YNX_VIDEO_DATA=/var/lib/ynx-video \
YNX_VIDEO_INTEGRITY_KEY='<at-least-32-byte-secret>' \
YNX_VIDEO_GATEWAY_ATTESTATION_KEY='<at-least-32-byte-secret>' \
YNX_VIDEO_SCANNER=clamdscan \
YNX_VIDEO_FFMPEG=ffmpeg \
YNX_VIDEO_MODERATORS='ynx1...' \
go run ./internal/video/cmd
```

## Wallet and Gateway boundary

The daemon does not accept a source-controlled or operator-created
`token=account` map. The central Gateway must first verify the exact
`packages/wallet-auth` v1 approval and product-device challenge. It then
attests each upstream request with `wallet-auth-v1`, `p256-sha256`, exact
client/bundle/sorted scopes/account/session expiry, a body hash, request time,
and a nonce under `YNX_VIDEO_GATEWAY_ATTESTATION_KEY`. The daemon verifies all
bindings and persists nonce consumption, so body/header substitution,
cross-product reuse, stale requests, exact replay, and changed replay fail after
restart.

Registered product contracts:

- `ynx-video-mobile-v1` / `com.ynxweb4.video`
- `ynx-video-web-v1` / `com.ynxweb4.video.web`
- `ynx-creator-studio-web-v1` / `com.ynxweb4.creator-studio.web`

Central registry publication remains integration-controller work; this service
fails closed until the Gateway supplies a valid attestation.

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
