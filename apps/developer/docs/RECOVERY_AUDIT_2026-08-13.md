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
| Multi-user persistent workspace | Owner-bound current state plus immutable server-local revision snapshots, paginated history/export and reviewed restore | `workspace-manager` 4/4 covers restart, isolation, legacy backfill, 50-revision retention and restore; authenticated `workspace-agent` history/export/restore and parallel-user gates passed | Run accepted public restart/restore and capacity evidence against the release service; server-local retention is not an object-store/disaster-recovery backup |
| Real build/run/test | Approved sandbox runners for C, C++, JavaScript, TypeScript, Python, Go, Java and Solidity plus separately reviewed project tests | `workspace-agent` direct gates cover real C/C++/JS/TS/Python/Go/Java/Solidity build/run and JS/Python/Go/C/C++/Cargo/JUnit/Hardhat Solidity project tests; Cargo is dependency-free, offline and locked; JUnit is compiled and executed with a SHA-pinned standalone runner; Hardhat uses a digest-verified solc 0.8.24 WASM artifact without workspace config/scripts; project environment resolves before spawn and live activity remains owner-scoped and redacted | Rust gates skip where the reviewed host toolchain is absent; the revised candidate still needs exact-version public gates |
| Dependency installation | Exact-version npm reconciliation and exact Python wheel installation in an owner/project LXD store with one-time review | `runtime-profile-service` rejects ranges, malformed locks and cross-owner access; npm disables lifecycle scripts; Python rejects source builds, requires pip report SHA-256 evidence for each wheel, atomically persists a project venv and returns a hashed `requirements.ynx.lock`; both bound storage, remove temporary egress and link only the project store into later tasks. The protected deploy verifies a fixed default-reject DNS/HTTPS-only LXD bridge/ACL, then installs/runs npm and Python, persists all locks, restarts, reruns both offline and rejects residual NICs | Obtain explicit production-owner approval to create the reviewed network, then execute and record the prepared public gate; Cargo, Go, Maven/Gradle and Solidity-framework adapters remain open |
| LSP, Outline and Problems | Bounded language-service bridge plus content-bound navigable document symbols and Problems records | C/C++, Java, Python, Solidity and TypeScript have direct completion/definition/diagnostic gates; Java's SHA-pinned JDT LS gate additionally proves references, rename, formatting and hierarchical document symbols; Outline preserves hierarchy and location while Problems renders severity/location/source/code | `gopls` and `rust-analyzer` skip where reviewed binaries are absent; the JDT LS direct gate skips outside the reviewed image; unopened-file whole-project analysis and complete cross-language formatting/rename/reference acceptance remain open |
| Terminal and long processes | Authenticated PTY/WebSocket broker with cloud and SSH profiles; detached sessions retain a bounded 256 KiB output tail and can be reattached only by the same owner/project/runtime before idle or hard expiry; the HTTP inventory is derived from the same live session map and exposes no command or environment values | `terminal-service` 7/7 covers a real PTY idle timeout, output after detach, owner-bound reconnect/replay, active-client replacement, cross-owner rejection for reconnect and stop, explicit WebSocket/API stop, project-environment injection and revision-safe workspace synchronization | Record the same stop/timeout/reconnect/inventory sequence against the accepted public release; detached sessions are intentionally server-memory-local and do not survive a gateway restart |
| Project environment | Owner/project-isolated SQLite WAL record with optimistic revisions, 32-key/16 KiB bounds, reserved-key denial, explicit non-sensitive literals and opaque Secret references; new local/LXD/SSH terminals and reviewed local/LXD tasks receive one resolved startup snapshot | `environment-service` 3/3 proves restart durability, owner isolation, stale-revision rejection, reserved-key denial and fail-closed Secret resolution; workspace-agent, terminal and runtime-profile suites prove local/LXD/SSH injection while inventories return only the revision | Install an accepted server-side Secret broker resolver and capture public restart/isolation evidence; Secret values are deliberately not accepted by the browser and unresolved references prevent process startup |
| Port preview | One-time reviewed LXD loopback-port capability with 10-minute expiry, four-grant owner limit, bounded request/response bodies, opaque-origin iframe and no IDE credential forwarding | `runtime-profile-service` proves owner/project/lease binding, cross-owner rejection, expiry/revocation, HTML/CSS prefix rewriting, CORS boundary, Cookie/Authorization stripping and fixed-stdin LXD bridge; Web product test verifies the iframe omits `allow-same-origin` | Capture a real public container HTTP-app preview; WebSocket upgrades, SSH forwarding, absolute URLs embedded in JavaScript and responses over 1 MiB remain explicitly unsupported |
| Debug Adapter Protocol | Authenticated, bounded DAP bridge for C/C++ via LLDB, Python via pinned debugpy, Rust via pinned Ubuntu LLDB 18, Go via pinned Delve 1.25.2 and Node.js via SHA-pinned Microsoft js-debug 1.117.0; Node/Python/Rust/Go require the selected owner/project-bound LXD lease, lock it for the session, keep external networking disabled and remove temporary adapter state on exit | Mock routing gates cover Node/Python/Rust/Go container paths; real debugpy reaches `value = 7` and real js-debug reaches `value = 13`; the protected image gate additionally requires Rust line 3 with `value = 9` and Go line 5 with `value = 11` | Execute and capture the protected public Node/Python/Rust/Go live-container DAP evidence; LLDB-DAP and Delve are unavailable on this macOS verifier |
| Git | Owner-isolated persistent repository broker with revision-guarded branch switching and merge persistence | Real status, stage, unstage, diff, 50-entry history, create/switch/delete branch and non-fast-forward merge passed; direct owner adapter and conflict-safe merge were exercised | Pull/push/PR execution remains fail-closed until an approved server-side credential/provider broker exists; interactive conflict resolution and public multi-user acceptance remain open |
| AI Software Engineer | Persisted Planner/context/Coder/Reviewer/Tester flow, exact-path create/edit/recoverable-delete, reviewed local Git commit, digest-bound deployment review and visible graded permission matrix | `agent-orchestrator` 4/4 and AI Web boundary 5/5 passed; Git preview binds revision/HEAD/branch/message/file digests/Tester hash, rejects drift, and consumes a separate one-time local-commit grant; remote Git stays disabled | Irreversible delete, package, browser-network, secret-reference and actual deployment adapters plus accepted public provider/cost evidence remain open |
| Project memory | Owner-isolated incremental text/vector and structured-fact index with explicit current-index retention | Semantic search, unchanged-vector reuse, declaration extraction for first-stage languages, resolved workspace-file imports, paginated chunk/fact export, legacy metadata migration, empty-file indexing, stale-clear rejection and user-confirmed clear passed | AST/LSP reference and API call graph, architecture/decision facts, change/test history and user-preference memory remain open |
| Collaboration | CRDT edit, ephemeral presence/chat and durable owner-controlled ACL roles | Convergence, viewer rejection, capacity, restart recovery, durable member listing, one-time-confirmed live revocation and access-validating reconnect passed | Shared-terminal floor/approval and multi-process deployment evidence remain open; terminal input stays off |
| Container/remote workspace | Owner-bound LXD leases, capability-scoped loopback preview and reviewed-host-key SSH | `runtime-profile-service` 16/16 passed, including packaged Java, reviewed npm, SHA-256-bound Python installation and isolated HTTP preview boundaries; text workspaces have separate server-local revision history | Build and deploy the revised nine-language image; Kubernetes lifecycle, sleep/wake, container-volume/object-store backup and restore, and public resource-limit evidence remain open |
| YNX Chain tools | Canonical chain identity, read-only RPC and transaction debugger | `chain-service` 3/3 passed | Wallet-approved deployment/receipt/verification end-to-end remains blocked on accepted central tuple |
| Wallet boundary | Exact registry attestation, introspection and final receipt gates | `wallet-readiness` 8/8 passed fail-closed | Owner `02-wallet-auth` and `29-integration` acceptance still pending; do not claim central integration |
| Extensions | Digest-addressed declarative registry isolated by owner with persisted enable state | Install/update, enable/disable and one-time-confirmed uninstall pass with exact-digest stale-write rejection; disabled contributions are removed from language/snippet/theme consumers | Marketplace/VSIX and executable runtime extensions remain blocked pending signature, worker/process crash isolation and source-policy acceptance |
| Web/PWA | React/TypeScript/Monaco workbench behind same-origin gateway with settings, project-wide literal replace, bounded text-project transfer and reviewed container preview | Settings control Monaco font/minimap/wrap and revision-safe save; replace has preview/confirm/recovery; directory/versioned-JSON import and JSON export enforce safe UTF-8 256-file/2 MiB limits; local in-app-browser evidence measured exact `390/390` document/viewport width after the main-grid containment repair; frontend/protocol checks and gateway 2/2 passed | Re-run current accessibility and the preview flow against the accepted public release service; binary/symlink/permission-preserving archive import is not claimed |
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
- Workspace manager: 4 passed (restart durability, isolation, restore, retention and legacy backfill).
- Workspace agent: 15 passed with the SHA-verified Rust `1.92.0` temporary toolchain; real Rust build/run and dependency-free offline Cargo tests join C/C++/JS/TS/Python/Go/Java/Solidity execution, reviewed project tests, environment, activity, cancellation and isolation gates through the network-disabled local sandbox.
- Language service: 11 passed, 1 skipped (`gopls` absent) when the same toolchain exposes its reviewed `rust-analyzer`; real C completion/diagnostics through clangd and complete Java editing intelligence plus semantic diagnostics through the SHA-pinned Eclipse JDT LS artifact also pass.
- Environment: 3 passed, including restart persistence, owner isolation, revision conflicts, reserved-key denial and fail-closed Secret references.
- Terminal: 7 passed, including real PTY timeout enforcement, project-environment injection, redacted live inventory, cross-owner stop rejection and a long-running shell process that continued after WebSocket detach, replayed output on an owner-bound reconnect, replaced a stale client, stopped explicitly and synchronized the workspace.
- Debug: local suites cover real debugpy and js-debug breakpoint/stack/locals plus mock Node/Python/Rust/Go container routing; reviewed LLDB-DAP and Delve are absent on this verifier, while the protected Rust/Go/Node image gates remain pending.
- Git: 1 passed.
- Extension registry: 1 passed.
- Model router: 4 passed.
- Agent orchestrator: 4 passed.
- Project memory: 3 passed.
- Collaboration: 4 passed.
- Runtime profiles: 16 passed, including packaged Java, reviewed npm, SHA-256-bound exact Python wheel installation, duplicate-lock and missing-integrity rejection, atomic project venv reuse and capability-scoped loopback preview boundaries.
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
nine-runtime, seven-LSP and restart gates, and secret-free hashed evidence. Public Java
status remains false until that transaction succeeds on the operator host.

The third repair slice completes the local Git workflow gate. Checkout and
merge require the exact workspace revision plus an idempotency key, then persist
the resulting text worktree through the authoritative workspace store. Failed
persistence rolls repository state back; a conflicted merge is aborted and
returns bounded conflict paths without advancing or rewriting the workspace.
The Source Control panel now exposes branch create/switch/merge/delete and the
50-entry local history. Pull, push and PR creation are deliberately preview-only:
the server validates a public credential-free HTTPS intent and returns a stable
SHA-256 digest, performs no network request, and states that execution is
unavailable until a server-side credential/provider broker is configured.
