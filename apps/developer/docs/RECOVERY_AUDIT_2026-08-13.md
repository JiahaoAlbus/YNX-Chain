# YNX Code recovery audit — 2026-08-13

## Recovery checkpoint

- Worktree: product 11 Developer worktree
- Branch: `codex/ynx-code-platform-v1`
- Audited source: `e061a30e801a9075dfea212a854b3d7d578d7e85`
- Upstream: `origin/codex/ynx-code-platform-v1`
- Protection result: clean tree, `0` ahead, `0` behind after fetch
- Current phase: `FREEZE`; central acceptance remains pending

This audit preserves the newer branch instead of returning to the older
`codex/final-developer` checkpoint. Artifact source and runtime checkpoint fields
remain historical on purpose: they identify the exact code embedded in the
published packages and must not be rewritten to the documentation-only HEAD.

## Requirement, implementation, direct evidence and gap matrix

| Requirement | Current implementation | Direct evidence at audit | Remaining gap / next gate |
| --- | --- | --- | --- |
| Multi-user persistent workspace | Owner-bound revisions, snapshots and idempotent recovery | `workspace-manager` 1/1; `workspace-agent` parallel-user and snapshot tests passed | Run accepted public restart/restore and capacity evidence against the release service |
| Real build/run | Approved sandbox runners for C++, JavaScript, TypeScript, Python, Go, Java and Solidity | `workspace-agent` 10 passed; real C++/JS/TS/Python/Go/Java/Solidity cases passed | Rust skipped because the reviewed host toolchain is absent; revised Java cloud image and package-install acceptance still need direct deployed-host gates |
| LSP | Bounded language-service bridge to real language servers | 8 passed: C++, Python, Solidity and TypeScript completion/definition/diagnostics | `gopls` and `rust-analyzer` skipped because reviewed binaries are absent; Java LSP and formatting/rename/reference acceptance remain open |
| Terminal and long processes | Authenticated PTY/WebSocket broker with cloud and SSH profiles | `terminal-service` 4/4 passed | Record stop/timeout/reconnect evidence for a public long-running task |
| Debug Adapter Protocol | Authenticated DAP bridge with bounded frames | Bridge test passed | Installed LLDB-DAP test skipped; Node, Python, Go and Rust adapter acceptance remains open |
| Git | Owner-isolated persistent repository broker | Real stage, diff and commit test passed | Branch/checkout/merge/history/pull/push approval and conflict-resolution acceptance remain open |
| AI Software Engineer | Persisted plan/context/coder/reviewer flow, approval and cancellation | `agent-orchestrator` 3/3; `model-router` 4/4 passed | Tester/deployment stages, full tool permission matrix and accepted public provider/cost evidence remain open |
| Project memory | Owner-isolated incremental index and vector ranking | `project-memory` 1/1 passed | Export, clear, rebuild, retention and architecture/symbol relationship acceptance remain open |
| Collaboration | CRDT edit, presence, chat, ACL roles and capacity bound | `collaboration-service` 3/3 passed including convergence and viewer rejection | Shared-terminal approval, revocation, reconnect and multi-process deployment evidence remain open |
| Container/remote workspace | Owner-bound LXD leases and reviewed-host-key SSH | `runtime-profile-service` 6/6 passed, including the packaged Java cloud command boundary | Build and deploy the revised eight-language image; Kubernetes lifecycle, sleep/wake, snapshot backup/restore and public resource-limit evidence remain open |
| YNX Chain tools | Canonical chain identity, read-only RPC and transaction debugger | `chain-service` 3/3 passed | Wallet-approved deployment/receipt/verification end-to-end remains blocked on accepted central tuple |
| Wallet boundary | Exact registry attestation, introspection and final receipt gates | `wallet-readiness` 8/8 passed fail-closed | Owner `02-wallet-auth` and `29-integration` acceptance still pending; do not claim central integration |
| Extensions | Digest-addressed declarative registry isolated by owner | `extension-registry` 1/1 passed | Install/enable/disable/uninstall UI, signing/source policy and crash isolation remain open |
| Web/PWA | React/TypeScript/Monaco workbench behind same-origin gateway | Frontend and protocol TypeScript checks; gateway 2/2 passed | Re-run browser E2E/current accessibility against the current release service |
| macOS arm64 | Full unsigned Testnet Preview package | Immutable artifact metadata and extracted launch/second-launch evidence in `ARTIFACT_MANIFEST.json` and `EVIDENCE_INDEX.md` | Intel/Universal build, production signing and notarization are false |
| Windows x64 | Unsigned hosted-workspace WPF client | Current Windows Actions/package evidence in `ARTIFACT_MANIFEST.json` and `EVIDENCE_INDEX.md` | Production signing is false; independent Windows installed recapture remains desirable |
| Linux and Docker/server | Server/runtime services and container profile architecture exist | Gateway/runtime tests passed locally | No immutable Linux desktop artifact or complete Docker/server release acceptance yet |
| Public deployment | `developer.ynxweb4.com` and immutable YNX-domain downloads recorded | Public reconnect/AI evidence and artifact manifests are versioned | Revalidate public URLs from an independent probe before advancing any checkpoint |
| Release/integration truth | Nine release states and versioned Developer contract exist | `product-release.json`, `developer-contract.json`, handoff and vectors | `integratedCentral`, production signing and store release remain false |

## Current verification record

Command:

`cd apps/developer && npm run code:check`

Result:

- TypeScript protocol and frontend checks passed.
- Workspace manager: 1 passed.
- Workspace agent: 10 passed, 1 skipped (Rust toolchain absent); real packaged Java compile/run passed through the network-disabled local sandbox.
- Language service: 8 passed, 2 skipped (`gopls` and `rust-analyzer` absent).
- Terminal: 4 passed.
- Debug: 1 passed, 1 skipped (reviewed LLDB-DAP absent).
- Git: 1 passed.
- Extension registry: 1 passed.
- Model router: 4 passed.
- Agent orchestrator: 3 passed.
- Project memory: 1 passed.
- Collaboration: 3 passed.
- Runtime profiles: 6 passed, including the packaged Java cloud adapter command boundary.
- Chain service: 3 passed.
- Wallet readiness: 8 passed.
- Gateway: 2 passed.

Skipped tests are unresolved acceptance gaps, not successful support claims.

## First and second repair slices

Keep the exact artifact provenance at source `76322af5` and runtime checkpoint
`17ee9ae5`, while updating coordination documents to identify the actual active
branch and this recovery audit. The next engineering slice should close one real
toolchain gap with an installed, reviewed runtime and direct build/LSP evidence;
it must not create a second Wallet, Quant, Finance, DEX or Calendar implementation.

The second slice adds Java syntax selection plus real `javac` build and `java`
execution to the local workspace agent and LXD runtime profile. It derives the
declared package, writes bytecode only below `.ynx-build/java`, launches through
a fixed classpath, and keeps the existing no-network sandbox. The local JDK gate
passed; the cloud image recipe now installs OpenJDK 21 and records exact Debian
package versions, but no new image fingerprint or public Java result is claimed
until the Linux operator builds and deploys that image.

The public domain was independently re-probed on 2026-08-13. `/healthz`
reported `0.2.0-testnet-preview-17ee9ae5-candidate`, and `/runtime/health`
reported the seven existing compilers without Java. Strict SSH authentication
to the documented host failed for all existing local reviewed key/user
combinations; no host state was changed. The repository now provides a bounded
transactional operator script with pre-switch tests, immutable source/image
identity, root-only temporary backup material, automatic code/config rollback,
eight-runtime and restart gates, and secret-free hashed evidence. Public Java
status remains false until that transaction succeeds on the operator host.
