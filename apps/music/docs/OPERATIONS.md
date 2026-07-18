# YNX Music operations runbook

## Staging layout

- Process: `ynx-musicd.service`, loopback `127.0.0.1:6440`
- Public staging path: `https://web4.ynxweb4.com/music/`
- Health: `https://web4.ynxweb4.com/music/health`
- State: `/var/lib/ynx-music`; binary: `/opt/ynx/music/ynx-musicd`
- Caddy path handler and hardened unit: `../deploy/`

The staging Web surface is read-only without a canonical native product session. `centralIntegrated` remains false until the Wallet registry entry and all three central operations are merged and deployed. Empty central variables intentionally make protected operations unavailable.

## Deploy and verify

Build with immutable metadata:

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath \
  -ldflags "-X main.commit=<git-sha> -X main.release=0.3.0-testnet-preview -X main.buildTime=<UTC>" \
  -o ynx-musicd ./apps/music/cmd/ynx-musicd
```

Upload to a temporary path, verify SHA-256, atomically rename, install the unit, validate Caddy, then restart. Never put central keys on a command line or in the repository. After restart, require `health.ok=true`, exact build commit/release, `centralIntegrated=false`, `licensedPublicCatalog=false`, and `productionStreaming=false`.

## Backup, recovery and rollback

Stop the service before a consistent backup. Copy `/var/lib/ynx-music` with ownership/mode preserved, verify the state hash on a separate restore directory, and restart. A failed integrity check must remain failed closed; do not edit the digest to force startup.

Keep the previous binary as `/opt/ynx/music/ynx-musicd.previous`. Rollback is an atomic binary swap followed by `systemctl restart`; record the old/new health commit. Central registry rollback is owned by Wallet/Auth and must revoke affected session/request digests.

## External release gates

Production Android/iOS signing, Play/App Store review, hosted immutable downloads, licensed catalog/CDN agreements, Pay committed-receipt ingestion and central registry deployment require owner-controlled credentials or approvals. Their status must stay false until evidence exists.
