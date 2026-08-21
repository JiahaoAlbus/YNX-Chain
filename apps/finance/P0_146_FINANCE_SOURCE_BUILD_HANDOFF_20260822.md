# P0-146 Finance source/build handoff

This checkpoint is a source/build-only candidate under lease
`P0-WALLET-CONNECTIVITY-2026-08-finance-7824-source-build-20260821T171613Z`.
It conveys no production deployment authority. P0-141 remains nonreusable.

## Candidate

- Source: `7824af677dd052d20321431381523ab302614d98`, tree
  `3db34ee2397a49852bbdf15e3841e7c9cecf9444`.
- Shared provider authority: `98c6d5d784d212df8981a53b17118a511e246ad2`, tree
  `51a60a362d4ad5dd748bcdefb101f71b1d9e0cee`.
- Local handoff archive: `/tmp/ynx-finance-7824af677dd0-linux-amd64-p0146.tar.gz`.
  It is 3,937,491 bytes with SHA-256
  `d8dcd45174dd50c93ef45af7d10d36dc078d6f4982da08dc92b9470e8290a59d`.
- Intended future release root: `/opt/ynx/releases/finance/ynx-finance-7824af677dd0`.
  The executable is exactly `ynx-finance` at that root; it is not under `bin/`.
- Linux amd64 executable SHA-256:
  `cccdae8ae5b5f694ca7db68540da30582564ff741978e616f7435d448a20fe3e`.

## Required later production preflight

Before any separately issued production lease permits a write, independently
re-read and require these rollback identities:

| Item | Expected SHA-256 |
| --- | --- |
| old root binary | `0cc43c8a77c12975a0fcbada65971f08f2bc3a52345d547ea194dd3ccd60d83f` |
| `/etc/ynx/finance.env` | `854e7f1077e8fa4d5a4741918e25d04b0c1a109f2eb9c716b72dae918aa5f252` |
| Finance systemd unit | `2e72cdad422a3a714c46d074ea97b725233576cf726dbbfd43e82e99c2c2975b` |
| Caddy configuration | `dcf75a7aed315c54632321b8bb80e44c0abc22f6700fadfbfa9a7da21b88a282` |

The only environment change is the exact redacted-safe line replacement:

```diff
- YNX_FINANCE_WEB_DIR=/opt/ynx/releases/finance/ynx-finance-3b2383f5c18a/web
+ YNX_FINANCE_WEB_DIR=/opt/ynx/finance-current/web
```

All other environment bytes must be preserved. The future rollback-first runbook
must back up exact old env bytes, restore them before restoring the old symlink,
and only then restart under its own lease.

## Evidence boundary

Go tests, race tests, 14 Finance Web tests, release-evidence verification,
provider-only Wallet verification, migration-gate verification, Web bundle,
archive extraction, checksum validation, and prohibited-endpoint scan passed.
The Linux binary was format-verified, not executed on this macOS host. No SSH,
SCP, service action, symlink/environment/Caddy write, Wallet approval, public
deployment, or public verification occurred.
