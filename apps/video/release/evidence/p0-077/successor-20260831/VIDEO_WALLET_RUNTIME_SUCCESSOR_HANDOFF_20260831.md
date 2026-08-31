# Video Wallet runtime successor handoff

This source/artifact checkpoint packages the latest Video Wallet chooser and lifecycle on top of the exact P0-239 recovery truth. It does not authorize or claim a deployment.

## Candidate

- Source: `560c467d61e74f7939b8ce527f14316c736b88a7`
- Tree: `82290b8d0c41615d9e48eff33e34d38695bbfc01`
- Durable carrier: `ynx-video-560c467d-runtime.tar.gz`
- Carrier: 25,780 bytes, SHA-256 `ebd197fd46eeef17ffeb9d9936c08997867dd3ff540ce332a73d06a8e8662a3f`
- Two independent builds are byte-identical.

The carrier includes `server.mjs`, the runtime manifest and topology, the P0-239 recovery baseline, the EIP-6963 provider SDK, and the distinct YNX Wallet / MetaMask chooser and lifecycle code.

## Safety boundary

The isolated Viewer target is `/opt/ynx-video-viewer-wallet`, unit `ynx-video-viewer-wallet.service`, port 6494. API 6493, Creator 6495, `/opt/ynx-video/current`, the legacy Viewer unit, and Caddy are outside the successor writable set.

The exact P0-239 e5ce predecessor carrier, shared-current tuple and target, legacy unit and Caddy hashes, and tuple-safe legacy recovery argv are frozen in `runtime/post-p0239-recovery-baseline.json`.

The shell fixture proves that a candidate Viewer failure after the current-link switch restores the exact predecessor, restarts Viewer only, preserves API and Creator bytes, and writes no success receipt. The controlled-takeover fixtures also pass at stop, port, bootstrap and post-start failure boundaries.

## Verification

- Video check: 25/25
- i18n audit: 12 locales, 22 exact keys
- deterministic carrier: byte-exact repeat
- extracted carrier served at isolated port 16494; root and Wallet module were read back with exact hashes and both identity markers
- no SSH, deployment, provider, account, signature or transaction action

Central must independently verify the Git carrier and issue a wholly-new Video-only single-use lease after a fresh production tuple readback. Earlier P0-237/P0-238/P0-239 leases are nonreusable.
