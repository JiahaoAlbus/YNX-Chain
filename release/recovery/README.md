# YNX 17 Economics Recovery Checkpoint

This directory contains a bounded recovery bundle for a verified local commit that could not be pushed because the remote connector returned HTTP 502 on three attempts.

- Branch: `codex/final-tokenomics`
- Base remote commit: `2b067ce8794054dd286b7f2fd99659a95890e0c3`
- Protected local commit: `f14d002`
- Commit subject: `feat(economics): bind local testnet evidence`
- Recovery status: local commit protected; remote sync pending
- Safety boundary: the evidence remains explicitly local simulation and does not claim shared Testnet, public deployment, or production activation.

Use `git bundle verify release/recovery/ynxt-economics-f14d002.bundle` before recovery. Fetch or clone the bundle, then apply the protected commit without destructive reset or force push.
