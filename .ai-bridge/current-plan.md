# YNX Video current plan

Status: ACTIVE
Phase: FREEZE → INTEGRATE
Authoritative runtime commit: `e9816e3ca95e1927c3398ecf169601f206d446c2`
Remote branch: `origin/codex/final-video`

## Completed checkpoint

- Recovered the existing Video service, Viewer, Creator Studio, Android/iOS projects and historical evidence without destructive Git operations.
- Created and tracked `origin/codex/final-video`.
- Enforced caller-declared SHA-256 on media upload, added structured rights basis/source/license/territory/expiry/evidence, and blocked publication when rights are missing or expired.
- Preserved HMAC compatibility for legacy records by omitting absent rights while failing closed on republishing them.
- Passed Video race tests, vet, Viewer checks/smoke and Creator Studio checks/smoke.
- Froze the final-branch integration contract, cross-product vectors and dependency acceptance package.
- Added explicit state schema versioning, ordered up/down migrations, a downgrade guard, legacy persistence upgrade and rollback round-trip tests.
- Added ffprobe-backed container/codec/duration/dimension/frame-rate validation and persisted probe metadata before FFmpeg transcode.
- Pushed `e9816e3ca95e1927c3398ecf169601f206d446c2`; local and remote branch heads matched.

## Highest-priority next actions

1. Add derivative SHA-256, bytes and original/derivative lineage to every generated media asset.
2. Restore a valid local ClamAV configuration/signature database and rerun the complete current-source loopback media E2E.
3. Rebuild current-source Android/iOS artifacts and refresh hashes/provenance/install evidence.
4. Complete current-source backup/restore drill, observability, SLO/capacity, unit economics and public metadata packages.

## Known blockers that do not stop autonomous work

- Shared full-repository tests fail in consensus/faucet/trust permission tests and on a missing IDE contract artifact; Video tests pass. Owners: YNX 01/11/15/30.
- Shared `no-placeholder-check` and `secret-scan` print false success when `rg` is absent. Owner: YNX 30.
- Current ClamAV installation has an invalid daemon config and no usable signature database; the service correctly remains unready.
- Central Wallet/Auth, Pay, Trust, Explorer, Monitor and Integration acceptance are not yet proven.
- Public deployment, DNS/TLS, production signing, physical devices and store credentials remain external release inputs.

Do not mark the product complete while any applicable item in `full-goal-coverage.json` is below `verifiedComplete` or truthfully `externalBlocked` with no autonomous work remaining.
