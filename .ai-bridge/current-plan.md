# YNX Video current plan

Status: ACTIVE
Phase: INTEGRATE
Authoritative runtime commit: `cbf35c029acb14011f4bb25e7b230e4d1fbbbd8e`
Remote branch: `origin/codex/final-video`

## Completed checkpoint

- Recovered the existing Video service, Viewer, Creator Studio, Android/iOS projects and historical evidence without destructive Git operations.
- Verified the configured MCP, `/Users/huangjiahao/Desktop/YNX Final Worktrees/33-video`, `codex/final-video` and `JiahaoAlbus/YNX-Chain` identity agree with Fable5.
- Enforced caller-declared SHA-256 on media upload, structured rights provenance and fail-closed publication when rights are missing or expired.
- Added explicit state schema migrations, downgrade protection, legacy persistence upgrade and rollback round-trip tests.
- Added ffprobe-backed container, codec, duration, dimension and frame-rate validation before transcode.
- Added SHA-256, byte count and original/derivative lineage to the HLS playlist, every generated HLS segment and the original fallback.
- Upgraded persisted state to schema v2. Legacy variants are backfilled from stored objects; a missing legacy asset is made private and failed instead of remaining publishable.
- Passed `go test ./internal/video/...`, `go test -race ./internal/video/...`, `go vet ./internal/video/...`, Viewer checks and Viewer smoke.
- Pushed `cbf35c029acb14011f4bb25e7b230e4d1fbbbd8e`; local and remote final-branch heads matched.

## Highest-priority next actions

1. Restore a valid local ClamAV configuration/signature database and rerun the complete current-source loopback media E2E.
2. Rebuild current-source Android/iOS artifacts and refresh hashes, provenance and install evidence.
3. Rerun a current-source backup/restore drill and record measured local RTO/RPO without production extrapolation.
4. Complete observability, SLO/capacity, unit economics and public metadata packages.

## Known blockers that do not stop autonomous work

- Shared full-repository tests previously failed in consensus/faucet/trust permission tests and on a missing IDE contract artifact; Video tests pass. Owners: YNX 01/11/15/30.
- Shared `no-placeholder-check` and `secret-scan` previously printed false success when `rg` was absent. Owner: YNX 30.
- The current ClamAV installation has an invalid daemon configuration and no proven usable signature database; Video correctly remains unready.
- No GitHub Actions run, PR or Video release currently exists for `codex/final-video`.
- Central Wallet/Auth, Pay, Trust, Explorer, Monitor and Integration acceptance are not yet proven.
- Public deployment, DNS/TLS, production signing, physical devices and store credentials remain external release inputs.

Do not mark the product complete while any applicable item in `full-goal-coverage.json` is below `verifiedComplete` or truthfully `externalBlocked` with no autonomous work remaining.
