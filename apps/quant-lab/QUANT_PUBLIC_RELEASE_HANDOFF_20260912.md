# Quant public release — 2026-09-12

## Actual result

`https://quant.ynxweb4.com/` now serves source `e022589fbd11024d7df075091a21de9f01565bf9`, tree `699f9085b591b9f299e9d0ce5e27648c716ea1c1`. This is a Testnet/research Linux server release, not a desktop/mobile installer or full Wallet/transaction completion.

Branch: `codex/quant-financial-flow-20260912`. Deployment command checkpoint: `2d103152c2315e94a31cb9a89a4fcc57c73a3da9`, tree `8b2aa6642e49d1728bd91ef058c06e116a12d90c`. The evidence successor does not change deployed product source.

- Release: `/opt/ynx-quant/releases/ynx-quant-lab-e022589fbd11`.
- Linux amd64 archive: `/tmp/ynx-quant-lab-e022589fbd11-linux-amd64.tar.gz`, 3461756 bytes, SHA256 `d354386dfc4bb7631ecb415a042044f1eac038ace82792eca9342697392924e5`; independent second build is byte-identical.
- Binary `ynx-quantd`: 8093880 bytes, SHA256 `d2ddb00eeb6eee4b2d92261c8fddb9cdf7985e07b942c058f65ffe665cd92c16`.
- `ynx-quant.service`: active/running, PID `1687645`, `NRestarts=0` at direct terminal capture.
- Quant-only drop-in `/etc/systemd/system/ynx-quant.service.d/90-quant-e022589fbd11-http-ready.conf`: tuple `[64770,4633072,0,0,420,1]` (mode 0644), SHA256 `f122f7ef0b43d0d0de4aaef2340ff8675774ad610045cbe09c93dfb5f97d12ac`.

## Public source and direct UI evidence

Both public HTTPS and loopback `127.0.0.1:18444` verified exact status, bytes and hashes for version, health, readiness and all 11 Web assets (HTML plus 10 JS/CSS files). Full receipts, including the unmodified 9570-byte successful stdout and its hash, are in `evidence/quant-e022589f-public-deployment-20260912.json`.

| Route | HTTP | Bytes | SHA256 |
| --- | --- | --- | --- |
| `/api/version` | 200 | 274 | `b38435ee3251e3120010ff77230f8f15ae3f53a5b5fae3f57a17ba25ed226bc5` |
| `/api/health` | 200 | 462 | `a5b4a75d212603ec1f2fccbdca57ed854f5b25910e2c3972337c183e590acf8f` |
| `/` | 200 | 21379 | `8982f22084815a2bed90039bbee7abe568b9823386a6c9f7d378736976beb59b` |
| `/api/ready` | **503** | 283 | `4592a6896439bfde9243868675ccb91625e3701a2389a895e2d693de36520655` |

Readiness is deliberately degraded: the actual host uses filesystem single-writer persistence, not a proven PostgreSQL/multi-instance database. Health 200 is not multi-instance readiness.

Computer Control personally opened the canonical public URL, executed a real stateless out-of-sample research request, and observed measured metrics (return 0 bps, buy/hold -50 bps, Sharpe 0.440) and equity curves. No mock provider, mocked response or request interception was used in this public verification. Paper/Portfolio guest navigation and reload were verified; public Paper submission remains disabled and no invented balance is shown. URL remained stable, one task tab remained one task tab, and mobile 390×844 had document width 375 (no horizontal overflow).

`evidence/quant-e022589f-public-browser-20260912.json` binds three actual screenshots. The final guest reload shows English with `html.lang=en`, locale `en`; initial research/mobile captures were automatically translated by Chrome. Twelve observed warnings originate in the MetaMask extension content script; no product error appeared in the queried warning/error records. This is not a global console-zero claim.

## Preserved state and ownership

The shared `/opt/ynx-quant/current` symlink remains `/opt/ynx/releases/financial-owner-reads/ynx-financial-owner-reads-443286487e05/quant`; it is also used by Exchange and was never switched. `ynx-quant-exchange.service` remained PID `2275763`, NRestarts 0. Caddy, original service unit and shared env were unchanged; no env values were output.

- Original unit SHA256 `ecf68b38cd1e14fc900e21d9bf86823c99b538382081585e2005a2a925709dd1`.
- Env SHA256 `d65a972203f51c8d78e789dfd010708310d47a93445c7bc9315bae40d856257e`.
- Quant Caddy SHA256 `fe86b1178f5f27b2fe225aaee1704e3ca8b083a30f1f6b25fbaf999b4b68ddb9`.
- `/var/lib/ynx-quant/quant.json`: 7159 bytes, SHA256 `cbe3948ec8cbf93ccd07224dac779dd9ccacd8c9a596fcfe0ba917ebc3b3cb60`, unchanged through activation. Existing strategies, experiments, audit and tenant state were retained. No stale state snapshot was restored.

The first activation failed when systemd became active before the HTTP listener; automatic rollback restored and verified old source/config/state/public bytes. Its complete immutable terminal is `evidence/quant-e022589f-first-attempt-auto-rollback-20260912.json`. The successful successor adds bounded exact-source HTTP readiness and uses a fresh own drop-in after revalidating the retained immutable candidate; it is not a repeated invocation of the failed command.

## Shared protocol and business boundary

Unmodified Standard SDK `c97f85e9ae4d4580b99860c51738e6040ca9ca18` and private SDK `a7dad7ec1bc7c06577978bdd5fea8dc9c7a248a9` are consumed; the factory and adapter use the same private bundle. Private authority is `https://wallet-auth.ynxweb4.com`; old-authority records are not moved or deleted. Exact dependency identities are recorded in `runtime-dependency-provenance.json` and the archive manifest. The official Go verifier and deployed read-integration dependencies were inherited unchanged.

Public research is stateless and bounded. Authenticated private `quant:account` proof does **not** silently grant saved strategies, schedule or Paper-write authority. Local authorized tenant workspace tests prove strategy ownership, idempotent Paper intent, body conflict and restart persistence; these tests are not public approved-account proof. Native mandate authorization is not provided by a read-only 0x-to-native-address mapping.

## Tests and artifact validation

- Go race: `go test -race ./internal/readintegration ./internal/productsessionv2 ./internal/quantlab ./apps/quant-lab/server` passed.
- `npm test --prefix apps/quant-lab`: 19/19 passed.
- Actual filesystem deployment fixture: `/usr/bin/python3 apps/quant-lab/tests/deploy_owned_runtime_test.py`, 5/5 passed; archive inventory/ELF/tamper, isolated success, forced asset failure/automatic rollback, foreign drop-in preservation and delayed source readiness covered.
- Earlier source validation: Standard browser 16, private browser 6, official private protocol 3, actual Go browser 4, persisted multi-user/multi-process tenant flow 1, canonical-authorize scanner passed. Browser protocol tests use test doubles and are distinct from direct public UI evidence.
- Two deterministic Linux archive builds matched exactly; candidate ELF ran as the actual service user in isolated protected-state validation before activation. Production state was not overwritten by the validation copy.

## Rollback method — not executed after success

Freshly verify the own drop-in tuple and SHA above, unchanged original unit/env/Caddy and shared current target. Reject substitution. Remove only that exact drop-in, then `systemctl daemon-reload` and `systemctl restart ynx-quant.service`. Do not restart Exchange or switch the shared current symlink. Its parent may be removed only if empty and still the exact created parent. Keep the immutable candidate release for audit.

Read back original source `443286487e057d78cb6b1a686d14bb37be8b3c23` at both public and loopback, original binary SHA256 `ae0d9d632eccca0b44cc92534e595a989a29fb3801f02bbba84feda8214553fb`, and service health. Prior root/version/health hashes are preserved in the first-attempt rollback evidence. **Never replace current state with the pre-deploy snapshot: preserve all new user writes.** The fixed activation command is consumed and must not be rerun.

## Honest remaining gaps

Real provider approval/rejection, private callback/session lifecycle, signing/EIP-712/send and native/desktop installation remain false and require their actual test-account/confirmation flows. No real capital order or transaction was performed. Public persistent strategies/Paper require a deliberate authenticated scope and proven durable multi-instance database; absent database configuration must not be bypassed. Scheduled tenant rediscovery after process restart still requires a durable scheduler/tenant enumeration design before unattended public claims. This public research release is useful but is not full Quant or ecosystem completion.
