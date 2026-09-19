# YNX Wallet evidence checkpoint — 2026-09-19

This checkpoint records the credential-independent Wallet acceptance run for source commit `bd0f012e9cb148fa7f4270e0e692482a7337030a`.

The JSON files preserve the acceptance summary, eight-artifact candidate manifest, rollback state, and Web artifact manifest. `SHA256SUMS.txt` binds every file stored in this directory. Binary installers and archives are intentionally excluded from Git.

The full raw runtime package existed only on the build host at `/tmp/ynx-wallet-bd0f012e9-acceptance`. That path is ephemeral and is not a public or durable download location. Reproduce the candidate from the exact source commit and compare the artifact hashes in `release-manifest.json`.

Release boundaries remain explicit:

- current source deployed publicly: false
- central integration: false
- rollback ready: false
- production signed: false
- store released: false
- HTTP toolbar action: manual required
- account authorized: false
- message signed: false
- transaction submitted: false

The locally test-signed Android APK is QA evidence only. The macOS DMG is unsigned and unnotarized. No deployment or production signing occurred in this checkpoint.
