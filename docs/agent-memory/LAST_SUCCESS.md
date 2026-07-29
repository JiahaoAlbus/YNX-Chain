# Last Success

Updated: 2026-07-29T02:45:09Z

The latest protected and fully re-verified source checkpoint is:

`3bff013d86ed5682950a38b114884ce6f17c423d`

Branch and remote were equal after push:

- local: `3bff013d86ed5682950a38b114884ce6f17c423d`
- `origin/codex/final-quant-lab`: `3bff013d86ed5682950a38b114884ce6f17c423d`

## Successful slice

The desktop release truth gap was closed without changing the release source inputs:

- rebuilt macOS arm64 and Windows x64 candidates twice using Go 1.25.7 on Darwin arm64;
- recorded the current reproducible archive hashes and toolchain;
- added explicit archive mismatch diagnostics;
- added a repeatable macOS archive verifier that safely extracts the package, restores permissions, verifies the ad-hoc signature, cold-starts the packaged supervisor, validates exact commit/health/metrics/frontend, and proves clean shutdown;
- preserved production boundaries: test signing only, Windows not executed, artifacts unhosted, no public deployment claim.

## Passed command

`apps/quant-lab/scripts/verify-release.sh`

The command passed after the slice was committed. Machine-readable macOS evidence is stored at:

`apps/quant-lab/evidence/local-macos-desktop-cold-start-20260729.json`

## Artifact truth

- macOS: `7df2bb3fd2f59ef3594a770004866feb8dff3495c3836bfeadec03d98dae2739`, 7,377,983 bytes.
- Windows: `4cdacd903aee1ab7aeafc9943258f42cf8522b19a8eda3e4f618b963c0a2f392`, 8,094,598 bytes.

This is a local candidate success, not central integration, shared Testnet verification, hosted release or production signing.
