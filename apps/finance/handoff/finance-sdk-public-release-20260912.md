# Finance SDK public release — 2026-09-12

## Source and deployment outcome

Finance owner branch: `codex/finance-wallet-flow-20260912`.
Runtime source `7a1d2aba6e72e5567931f451a9f069a544f58783`, tree `2a802bdc2ac0963bf6babe728bf0355012b3a0a6`.
Protected executor checkpoint `50feecb9ac962c9914b14f89c1eebacd2c78bbf0`, tree `a096b0049ac99a0439607e6ffa90505179c8c319`.
The final evidence commit is a successor; no self-referential source claim.

New Finance-only deployment was explicitly authorized by the current root coordinator/user scope. No August lease was reused. No shared Caddy/unit/drop-in, Wallet, Core, Faucet, AI, Exchange or Quant service was changed.

`https://finance.ynxweb4.com/` is now source-bound to the SDK runtime. One actual Finance stop/start and current/env switch succeeded, with zero automatic rollbacks. The first protected attempt stopped at isolated validation before any service/env/current change because the verifier incorrectly requested `/index.html`; the actual document route is `/`. The tool-only correction used a new namespace, unchanged candidate bytes, and a regression test.

- Current: `/opt/ynx/finance-current` → `/opt/ynx/releases/finance/finance-sdk-7a1d2aba-20260912T104700Z-r2`.
- Service: `ynx-finance.service`, ynx:ynx (995:986), PID `1664408`, active/running, NRestarts `0` at deployment receipt.
- Fixed archive: 3,996,021 bytes; SHA-256 `60e9703135f6a46f1f563d7ff5b2ae8419fae65c664f176d6fda0b8ca0b570fc`.
- Linux amd64 binary: 8,626,360 bytes; SHA-256 `d0cc204f851afa0aace9bba06c3048a0bd1dc623b686eac56cab8ae6e0046c77`.
- Public and loopback `/version`: HTTP 200, 138 bytes, SHA-256 `386276d214105035883b4fbb94fcec52a9794b9b5a73611fb3349abe72e882ee`.
- Public and loopback `/health`: HTTP 200, 493 bytes, SHA-256 `f78efc4e15c6a83a2cf4da17ce0c9ea7a16afae6d45a2560ac6820f6aac4bf0d`.
- Public root: HTTP 200, 12,649 bytes, SHA-256 `06eafa1ce886d1b89ae00b728210c2dc3a51e6acb59cb4a1f34a44058cd236f8`.
- All seven Web assets match the frozen artifact on both loopback and canonical public domain; exact bytes/SHA/MIME receipts are in `../evidence/finance-sdk-public-deployment-20260912.json`.
- Environment is 1,602 bytes, SHA-256 `000ef2feed4a35b1b0f17cf9955433ea354e786bdd65a724f8204d0a1c66fd7a`, root:ynx 0640. Only `YNX_FINANCE_WEB_DIR` changed to the immutable candidate `/web` and `YNX_FINANCE_AUTH_MODE=product-session-v2` was added. All original secret and legacy authority values remain unchanged and were not output, migrated or deleted.

## Data and safety

Fresh preflight proved one Finance writer, file state storage, no configured database, and `/var/lib/ynx/finance/state.json` absent. It remained absent when the old service was stopped and after the new service started. The candidate first ran as actual uid 995/gid 986 against an isolated absent state on a free loopback port; source/health/ready/assets passed before service changes.

Old and candidate `internal/finance/store.go`, `state_repository.go`, and `types.go` are byte-identical Git objects (`e8346d2b55e59335766cf5f43b2677c1fcb97041`, `5737de34266f47c7e6760780f0ce799ddf790210`, `e49e4bad17ef7c02c2596fbb3435a7edad4a581d`). Rollback preserves the newest state; no old snapshot is automatically restored. Post-deployment user data must never be overwritten by the originally absent-state baseline. File-CAS is single-host; PostgreSQL multi-instance state is not configured or claimed.

## Rollback boundary and retained material

Old release remains `/opt/ynx/releases/finance/ynx-finance-3b2383f5c18a`, binary SHA-256 `0cc43c8a77c12975a0fcbada65971f08f2bc3a52345d547ea194dd3ccd60d83f`.
Exact old env backup: `/opt/ynx/stage/finance/finance-sdk-7a1d2aba-20260912T104700Z-r2/rollback/finance.env`, SHA-256 `854e7f1077e8fa4d5a4741918e25d04b0c1a109f2eb9c716b72dae918aa5f252`. Unit/drop-in/Caddy copies are retained in the same root-private backup directory for evidence, not for overwriting shared configuration.

Any later rollback first requires fresh owner checks of current, environment, newest state and service. Verify both release hashes and backup hash, stop only Finance, atomically replace Finance env through a same-directory no-replace temporary file preserving root:ynx 0640, atomically point current to the old release, start only Finance, verify old public/loopback receipts. Do not restore state, change Caddy/unit, or touch another service. The frozen executor contains the automatic rollback implementation, but that path was not triggered during the successful production switch. This handoff does not authorize an unattended future rollback.

The valid candidate release, protected rollback directory, and uploaded archive are retained intentionally. The first pre-switch failed attempt's release/stage backup and its empty isolated-state directory remain as diagnostic evidence; no zero-residue claim is made. No state or credential contents are included in Git evidence.

## Browser, tests and remaining gates

Real Computer Use opened the source-bound public root without injected providers or intercepted HTTP. English guest view, separate YNX/MetaMask controls and official links, Standard/private separation, Continue as guest and reload passed; console error/warning counts were zero and tab count stayed one. Desktop and 390×844 mobile screenshots were emitted in tool output; no horizontal overflow was observed. Screenshots are not separately durable local files because this in-app surface does not export content. See `../evidence/finance-sdk-public-guest-browser-20260912.json`.

The browser then denied navigation to `/version` with `net::ERR_BLOCKED_BY_CLIENT`. No alternate browser/curl/SSH readback was used after that denial. The earlier authorized deployment HTTP version receipt is preserved with this ordering; browser version navigation itself is false.

Retained source tests: 35/35 Node, Go race for Finance/shared verifier, security and repeat-build/archive inventory passed. Deployment helper added 5 local guard tests. Actual Linux isolated startup and the public service succeeded. These are server/Web proofs, not native installers.

Real provider account approval/rejection, private approved callback, signing, EIP-712, transactions, installed products and complete ecosystem remain **false**. No Connect/Authorize/Revoke button was clicked publicly. Web default is English; full Web localization, budget progress/coverage, lossless financial amount handling and next business work remain separate unfinished slices. Source/local protocol fixtures do not promote those public lifecycle gates.
