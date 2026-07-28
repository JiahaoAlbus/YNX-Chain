# YNX Video current plan

Status: ACTIVE
Phase: PROTECT → FREEZE
Authoritative runtime commit: `11e64797c64cd64d1c6e53f0295c17997bde6f97`
Remote branch: `origin/codex/final-video`

## Completed checkpoint

- Recovered the existing Video service, Viewer, Creator Studio, Android/iOS projects and historical evidence without destructive Git operations.
- Created and tracked `origin/codex/final-video`.
- Enforced caller-declared SHA-256 on media upload, added structured rights basis/source/license/territory/expiry/evidence, and blocked publication when rights are missing or expired.
- Preserved HMAC compatibility for legacy records by omitting absent rights while failing closed on republishing them.
- Passed Video race tests, vet, Viewer checks/smoke and Creator Studio checks/smoke.
- Pushed `11e64797c64cd64d1c6e53f0295c17997bde6f97`; remote SHA matched after one transient 502 retry.

## Highest-priority next actions

1. Freeze the final-branch integration contract, cross-product vectors and dependency acceptance package.
2. Add explicit state schema versioning, migration registry, downgrade guard and rollback migration test.
3. Add ffprobe-backed codec/duration/dimension validation and derivative lineage hashes.
4. Restore a valid local ClamAV configuration/signature database and rerun the complete current-source loopback media E2E.
5. Rebuild current-source Android/iOS artifacts and refresh hashes/provenance/install evidence.
6. Complete current-source backup/restore drill, observability, SLO/capacity, unit economics and public metadata packages.

## Known blockers that do not stop autonomous work

- Shared full-repository tests fail in consensus/faucet/trust permission tests and on a missing IDE contract artifact; Video tests pass. Owners: YNX 01/11/15/30.
- Shared `no-placeholder-check` and `secret-scan` print false success when `rg` is absent. Owner: YNX 30.
- Current ClamAV installation has an invalid daemon config and no usable signature database; the service correctly remains unready.
- Central Wallet/Auth, Pay, Trust, Explorer, Monitor and Integration acceptance are not yet proven.
- Public deployment, DNS/TLS, production signing, physical devices and store credentials remain external release inputs.

Do not mark the product complete while any applicable item in `full-goal-coverage.json` is below `verifiedComplete` or truthfully `externalBlocked` with no autonomous work remaining.
