# YNX Music operations runbook

## Staging layout

- Process: `ynx-musicd.service`, loopback `127.0.0.1:6440`
- Public staging path: `https://web4.ynxweb4.com/music/`
- Health: `https://web4.ynxweb4.com/music/health`
- State: `/var/lib/ynx-music`; binary: `/opt/ynx/music/ynx-musicd`
- Caddy path handler and hardened unit: `../deploy/`

The Web surface permits bounded guest discovery and playback of published non-explicit Testnet media. Private operations require one of the two reviewed Music Product Sessions and a fresh sender-constrained proof. The central contract is integrated in source; current-source staging/public deployment remains false until a deployment receipt binds the runtime, Gateway registry and build commit together.

## Deploy and verify

Build with immutable metadata:

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath \
  -ldflags "-X main.commit=<git-sha> -X main.release=0.3.0-testnet-preview -X main.buildTime=<UTC>" \
  -o ynx-musicd ./apps/music/cmd/ynx-musicd
```

Upload to a temporary path, verify SHA-256, atomically rename, install the unit, validate Caddy, then restart. Never put central keys on a command line or in the repository. After restart, require `health.ok=true`, exact build commit/release, `centralContractIntegrated=true`, `centralDeploymentVerified=false` until the external E2E receipt is captured, `licensedPublicCatalog=false`, and `productionStreaming=false`.

## Backup, recovery and rollback

Create a verified checkpoint without overwriting an existing destination:

```bash
systemctl stop ynx-musicd
/opt/ynx/music/ynx-musicd \
  -data /var/lib/ynx-music \
  -backup /var/backups/ynx-music/<UTC-checkpoint>
systemctl start ynx-musicd
```

The command writes a private `manifest.json`, `state.json` and the exact referenced media inventory. It verifies the source state integrity, audit chain, track identities, media SHA-256 values and private file permissions before publishing the backup directory.

Restore only into a clean destination; the command refuses to overwrite either `state.json` or `media/`:

```bash
/opt/ynx/music/ynx-musicd \
  -data /var/lib/ynx-music-restored \
  -restore /var/backups/ynx-music/<UTC-checkpoint>
/opt/ynx/music/ynx-musicd -data /var/lib/ynx-music-restored -http 127.0.0.1:6540
```

Verify `/health`, the exact build commit, catalog access, creator ownership, listener recovery and one media range request before replacing the active data directory. A failed digest or integrity check must remain failed closed; never edit a manifest or state digest to force startup. Record elapsed backup/restore time and bytes before assigning RTO/RPO.

Keep the previous binary as `/opt/ynx/music/ynx-musicd.previous`. Binary rollback is an atomic swap followed by `systemctl restart`; record the old/new health commit. State schema v2 accepts and atomically migrates verified schema-v1 inputs, but downgrade from v2 is not yet supported. Central registry rollback is owned by Wallet/Auth and must revoke affected session/request digests.

## External release gates

Production Android/iOS signing, Play/App Store review, hosted immutable downloads, licensed catalog/CDN agreements, Pay committed-receipt ingestion and central registry deployment require owner-controlled credentials or approvals. Their status must stay false until evidence exists.
