# YNX 17 Decision Log

Updated: 2026-07-29T02:56:46Z

## 2026-07-29 — Preserve the matched workspace and branch

The MCP workspace, Fable5 product identity, Worktree, branch, and Git remote all matched YNX 17. No alternate workspace, reset, clean, branch replacement, or destructive recovery action was used.

## 2026-07-29 — Treat Git and CI as authoritative over stale status prose

Historical plan/status files described work and blockers that no longer matched current commits or GitHub Actions. Recovery conclusions were rebuilt from the real branch, remote SHA, commit history, files, tests, and Actions runs. Stale claims are not used as completion evidence.

## 2026-07-29 — Generate ignored compiler evidence instead of committing caches

Go tests consume pinned Hardhat bytecode and selector metadata. These outputs are intentionally ignored, so `make test` and `make integration-test` now generate both prerequisites. Generated build directories remain uncommitted.

## 2026-07-29 — Fetch complete history for provenance validation

Economics release gates deliberately verify persisted historical source commits using Git object identity. CI therefore uses `fetch-depth: 0`; weakening or deleting source-commit checks was rejected.

## 2026-07-29 — Preserve archive validation while fixing GNU tar portability

GNU tar reports a broken pipe when `grep -q` exits after a match under `pipefail`. The dry-run now first performs a complete archive listing, validates the release manifest from that listing, and scopes `pipefail` off only for repeated membership probes. The archive is still read and validated before those probes.

## 2026-07-29 — Keep release-state booleans evidence-bound

A green CI run is candidate evidence, not central integration, production signing, public deployment, hosted download, store release, or mainnet release. Those booleans remain false until direct matching evidence exists.

## 2026-07-29 — Enforce the official domain boundary

`ynxweb4.com` is the sole YNX product domain. `huangjeo.com` remains a Founder personal domain, while `mcp17.huangjeo.com` remains a valid MCP service address. No product canonical, release, docs, status, support, or Website handoff may use the Founder domain.
