# YNX Code architecture

Status: normative architecture, implementation gates apply  
Product: YNX Code / YNX Developer  
Network: YNX Testnet `ynx_6423-1` / EVM chain ID `6423`

## 1. Product contract

YNX Code is an AI development operating system. It combines a professional IDE,
isolated local and cloud workspaces, language/debug protocols, source control,
collaboration, a permissioned software-engineering agent and native YNX Chain
development. It does not claim a toolchain, deployment, model, extension or
capacity tier until direct runtime evidence exists.

The Web surface is a client. Source execution never happens in the browser
process and never shares the Web server's filesystem. Every executable action
targets an explicit workspace runtime. Desktop may host a local runtime;
cloud workspaces use short-lived isolated containers. Contract deployment is
Wallet-only: YNX Code can build, simulate and prepare an intent, but it cannot
hold or reconstruct a user signing key.

## 2. Non-negotiable acceptance

A milestone is accepted only when the exact public or packaged build can:

1. create, rename, move, delete and restore nested project files;
2. open multiple files with dirty state, tabs, split editors and recovery;
3. provide Monaco syntax services without a textarea fallback presented as an IDE;
4. execute an actual compiler/interpreter in an isolated workspace and stream
   stdout, stderr, exit code, duration and immutable task evidence;
5. expose missing toolchains as missing, with an install/rebuild path;
6. keep different users, projects, terminals, secrets and agent authority isolated;
7. survive reconnect/restart according to the workspace tier's stated durability;
8. enforce preview and approval for write, execute, network, package, Git, secret
   and deploy actions;
9. publish source commit, artifact hash, signing class and measured capacity;
10. pass keyboard, screen-reader, RTL, error, offline and recovery checks.

The first language gate is a real C++ project that creates `src/main.cpp`, shows
C++ language mode, compiles it with the selected C++ adapter and streams its
actual output. JavaScript, TypeScript, Python, Rust, Go and Solidity follow the
same protocol rather than special-case UI success messages.

## 3. Repository architecture

```text
apps/developer/
  frontend/                       React + TypeScript client
    src/
      app/                        workbench composition and routes
      components/ui/              YNX-owned accessible primitives
      editor/                     Monaco models, tabs, split and diff
      explorer/                   workspace tree and file operations
      terminal/                   xterm client and process lifecycle
      search/                     text and semantic search clients
      scm/                        Git status, diff and review surfaces
      debug/                      DAP client and debug views
      extensions/                 extension registry and permissions UI
      agent/                      plan, tool review, run and audit UI
      collaboration/              presence, document and terminal sharing
      blockchain/                 YNX templates, simulation and Wallet handoff
      state/                      normalized client state and recovery
  protocol/                       versioned shared TypeScript contracts
    workspace/                    files, snapshots, watch events
    task/                         process, output and cancellation
    lsp/                          JSON-RPC/LSP tunnel envelopes
    dap/                          DAP tunnel envelopes
    agent/                        plans, tools, approvals and audit
    extension/                    manifest and capability model
    collaboration/               presence and CRDT events
    deployment/                  build/simulation/Wallet/receipt state
  services/
    gateway/                      authenticated API/WebSocket ingress
    workspace-manager/            lifecycle and placement control plane
    workspace-agent/              per-runtime file/process/LSP/DAP host
    agent-orchestrator/            planner/coder/reviewer/tester/deployer graph
    model-router/                  managed/BYO model policy and accounting
    indexer/                       syntax graph and semantic project memory
    collaboration/               CRDT rooms, presence and ACLs
    extension-registry/           signed manifests and compatibility
    deployment/                  build evidence and Wallet-only intent broker
  runtime/
    images/                       pinned language workspace images
    sandbox/                      seccomp/AppArmor/network/resource policies
    toolchains/                   reviewed adapters and version discovery
  desktop/                       macOS/Windows shell and local runtime broker
  cli/                           workspace, task and deployment CLI
  sdk/                           extension, agent tool and YNX development SDK
  docs/                          architecture, operations and evidence
```

The current legacy Web implementation remains operational during migration. New
modules replace it behind versioned interfaces; no existing verified release is
deleted until the new path passes parity, migration and rollback gates.

## 4. Runtime topology

```text
Browser / Desktop
  -> Edge Gateway (Product Session, request ID, quota, WebSocket resume)
    -> Workspace Manager (tenant/project/runtime policy)
      -> Workspace Agent inside one sandboxed runtime
         - virtual filesystem and watcher
         - PTY/process supervisor
         - LSP supervisor
         - DAP supervisor
         - Git broker
         - extension host
    -> Agent Orchestrator
      -> Model Router
      -> permission broker -> Workspace Agent tools
    -> Collaboration service -> CRDT log/presence
    -> Project indexer -> symbol graph/vector index
    -> Deployment service -> simulation -> YNX Wallet -> Chain
```

Control-plane services are stateless behind load balancers except for durable
stores. Workspace Agents are stateful only for the lifetime of their assigned
runtime and reconnect through a signed lease. A browser cannot select another
tenant, runtime path, container ID or host command.

## 5. Workspace and file protocol

Every workspace has opaque IDs: `tenantId`, `projectId`, `workspaceId`,
`runtimeId` and monotonically increasing `revision`. APIs accept normalized
workspace-relative POSIX paths only. Absolute paths, traversal, NUL, ambiguous
Unicode separators, symlinks escaping the root and reserved internal paths fail
closed.

File mutations use expected revision plus idempotency key. Rename/move is one
atomic operation. Delete moves an entry into a workspace trash revision; hard
delete is a separate permission. Save conflicts return both base and current
revision and open a diff/merge surface. Watch events contain revision, actor,
operation and affected path; clients resume from the last acknowledged cursor.

Desktop and cloud use the same protocol. IndexedDB is only an offline client
cache and crash-recovery journal, never the authoritative cloud workspace.

The current server-local workspace store retains the latest 50 immutable text
snapshots per signed owner/project. Every accepted mutation, including a restore,
advances the monotonically increasing revision and records SHA-256, source,
timestamp and optional `restoredFrom`; restore never overwrites an old revision.
History listing returns metadata only. A separate authenticated revision read
exports the full bounded snapshot, while restore requires the exact current
revision, a fresh owner-scoped UUID approval, a separate idempotency key and one
SQLite `BEGIN IMMEDIATE` transaction. Existing databases backfill their current
revision on open. At the 256-file/2 MiB workspace ceiling, the explicit worst-case
retained payload is approximately 100 MiB per project before SQLite overhead.
These snapshots survive service restart, but remain on the same server volume:
they are not object-store replication, container-volume backup or disaster
recovery. Operators and users must export important revisions independently.

## 6. Editor engine

Monaco owns one model per canonical file URI. The workbench implements:

- multi-select explorer operations and native keyboard naming flow;
- preview/pinned tabs, dirty markers, close/reopen and hot exit;
- horizontal/vertical editor groups with independent selections;
- bounded project-wide literal search/replace with case policy, exact preview,
  confirmation, multi-file dirty tracking and collaboration write enforcement;
- versioned JSON project import/export plus browser directory import, enforcing
  safe relative paths, strict UTF-8, duplicate rejection and the shared
  256-file/2 MiB text-workspace ceiling; it does not represent an archive format;
- a content-bound Problems model populated from actual Monaco/LSP markers, with
  severity/location/source/code, live count and file navigation; stale content is
  filtered and unopened-file whole-project coverage is not claimed;
- a workspace/file breadcrumb and a content-bound current-file Outline using
  real LSP `textDocument/documentSymbol` responses; the UI preserves hierarchy,
  caps rendered symbols at 500 and navigates Monaco to the returned line/column;
- schema-sanitized device-local editor preferences for font size, minimap, word
  wrap and bounded auto-save delay; explicit Save remains a revision-checked
  server mutation when auto-save is disabled;
- Monaco diff editors for SCM, checkpoints and agent proposals;
- workspace search/replace with preview and atomic apply;
- command registry, keybinding resolver and command palette;
- themes as signed/validated extension contributions;
- incremental model loading and large-file limits;
- worker-based tokenization and semantic token updates.

Editor state is separate from file state so a tab can be closed without losing
saved content and a failed save never clears the dirty marker.

## 7. Language intelligence

YNX Code implements a protocol-neutral LSP client. Workspace Agents launch a
reviewed language server adapter and expose JSON-RPC over a multiplexed,
back-pressure-aware channel. Initial server set:

| Language | Server / toolchain candidate | Minimum gate |
| --- | --- | --- |
| JavaScript / TypeScript | TypeScript language server | completion, definition, rename, references, diagnostics, format |
| Python | Pyright + selected interpreter | same plus actual run/test |
| Rust | rust-analyzer + Cargo | same plus `cargo check/test/run` |
| Go | gopls + Go toolchain | same plus `go test/run` |
| C / C++ | clangd + Clang/GCC adapter | same plus actual build/run |
| Solidity | Solidity LSP + pinned solc | same plus artifact/source map |

Move and Cosmos SDK are extension/toolchain profiles after the first-language
gate. LSP capabilities are negotiated; the UI never enables a command the
server did not advertise. Diagnostics include source, version and staleness.

The execution gate is tracked separately from LSP. The Linux candidate actually
builds or runs C, C++, JavaScript, TypeScript, Python, Go, Rust and Solidity inside
the network-disabled workspace container. TypeScript is first transpiled by the
installed `tsc`; only the validated workspace and `.ynx-build` are writable.
macOS verifies its locally installed subset and reports missing toolchains as
unavailable instead of simulating success.

The reviewed cloud image carries clangd 18.1.3, TypeScript 5.9.3 behind
`typescript-language-server`, Pyright 1.1.411, gopls 0.16.2, the checksum-
verified rust-analyzer 2026-07-27 release and Nomic Foundation Solidity Language
Server 0.8.25. The image build runs an actual LSP `initialize` exchange against
all six servers before publication. Monaco completion, go-to-definition,
reference search, rename, formatting and diagnostics use the same protocol
client; each request includes the signed project and selected runtime identity.
The gateway accepts only allowlisted server binaries and environment keys,
materializes a disposable project-scoped copy in the leased container, holds a
lease lock for the LSP lifetime, disables network access and removes the copy on
completion. The server process is never selected from user input.

The 2026-08-10 live candidate gate created a fresh container from the immutable
v2 image, compiled or ran all seven language paths, then obtained real
completion results from clangd, TypeScript Language Server, Pyright, gopls,
rust-analyzer and the Solidity Language Server in that same container. It also
opened a PTY, wrote a file, synchronized the revisioned workspace and deleted
the lease with no container left running. Compiler diagnostics for Solidity
continue to use pinned `solcjs 0.8.36 --standard-json`; successful compilation
materializes bounded integrity-addressed ABI, bytecode, metadata and source maps.
The task envelope carries each exact UTF-8 artifact with its byte count and
SHA-256 value. Before project persistence, the browser recomputes every digest,
enforces the existing 256-file/2 MiB persistent-workspace limits and writes a
`.ynx-build/manifest.json` binding compiler evidence, Solidity source digests and
artifact digests. The public `/ide/compiler` value 0.8.24 remains separate
Testnet analysis metadata and currently declares production compilation disabled;
it is never substituted for the actual 0.8.36 workspace compiler evidence. The
vulnerable `tmp 0.0.33` transitive dependency is overridden with patched 0.2.7.

For a verified creation bytecode artifact, the Chain panel may request
`eth_estimateGas` and `eth_gasPrice` through the read-only RPC allowlist and show
their bounded multiplication in wei. This is explicitly an RPC fee estimate,
not bytecode execution proof or a transaction. Final fee bounds still belong in
the later Wallet authorization intent.

## 8. Tasks, terminal and process supervision

Terminal transport uses a PTY only inside the selected runtime. The process
supervisor owns PID, process group, cwd, environment allowlist, CPU/memory/PID/
disk/time limits and cancellation. Output is streamed with ordered sequence IDs,
bounded replay and truncation markers. Browser disconnect does not orphan a
process; the runtime policy decides continue, pause or cancel.

The Web task broker now has two distinct reviewed envelopes: `build-run-active`
requires `execute-once`, while `test-project` requires `test-once`. Project test
discovery is server-duplicated from the visible client preview and selects only
Node built-in tests, Python unittest discovery, same-directory Go package tests and
standalone C/C++ tests, dependency-free Cargo projects executed with a canonical
lock plus `--offline --locked`, JUnit Jupiter tests compiled from explicit Java
sources and executed by a SHA-pinned Console Standalone runner, and Solidity
`.t.sol` tests compiled with Hardhat `3.9.0` plus the digest-verified solc `0.8.24`
WASM artifact. Solidity sources are copied into an isolated generated Hardhat
project; user configuration, plugins and package scripts are not executed. It accepts at
most 32 discovered test files and 20 phases and
uses the same no-network Bubblewrap/prlimit or sandbox-exec boundary, streaming
and output limits. It never evaluates package-manager scripts or an arbitrary
command string.

The current foundation implements this boundary through
`services/terminal-service`: a same-origin, signed-session WebSocket upgrades to
an actual `node-pty` shell inside the existing macOS `sandbox-exec`, Linux
Bubblewrap/prlimit, owner-bound LXD or reviewed-host-key SSH workspace. It
enforces per-owner/global session ceilings, input and resize bounds, idle/hard
lifetime cleanup and revision-checked text snapshot synchronization. A signed
HTTP inventory and stop endpoint reads the same in-memory session map; it
returns lifecycle/replay/environment-revision metadata but never commands or
environment values. Task output remains a separate, non-interactive terminal
surface. Shared-terminal input and object-store-backed runtime volumes remain
gated and are not represented as available.

`services/environment-service` stores at most 32 owner/project-scoped entries in
SQLite WAL behind an optimistic revision and a one-time reviewed update. An
entry is either an explicitly non-sensitive literal or an opaque Secret broker
reference. Runtime-reserved keys are rejected. The browser never submits Secret
values; when the server has no approved resolver, any referenced Secret fails
process startup closed. A resolved snapshot is injected only into a newly
created local/LXD/SSH terminal or reviewed local/LXD task. Terminal and task
inventories expose its revision, never its keys or values. Task activity is
derived from the real bounded execution queue and disappears on completion.
An owner-bound Stop request atomically removes a `queued` task before execution
and returns `task_cancelled` to its original request, or moves a running task to
`stopping`, aborts its detached process group and returns code 130. Activities
are removed after cancellation or workspace cleanup. Cross-owner and stale task
IDs return 404.

Tasks are declarative records (`command`, argument array, cwd, environment class,
problem matcher, timeout, network policy and artifact outputs). Shell parsing is
not used for generated tasks. Interactive terminals may use a shell after the
user explicitly starts one. Docker and SSH are capabilities, not implicit host
access: Docker targets a workspace runtime; Remote SSH requires a user-owned
connection profile and host-key review.

The Linux candidate adds a runtime-profile control plane backed by SQLite WAL.
An owner may create only the reviewed `ubuntu:24.04` LXD profile after an
explicit one-time approval. Each opaque lease receives a dedicated container,
2 CPU, 2 GiB memory, a 10 GiB root volume and the `ynx-code-isolated` profile,
which deliberately contains no network device. The exact base-image fingerprint
is returned as creation evidence and stop deletes only the container resolved
through the signed owner's lease record. The candidate host lifecycle smoke test
created, entered and deleted a real Ubuntu 24.04 container with no IPv4/IPv6.

The current reviewed toolchain and language-intelligence image is pinned by its
immutable LXD fingerprint
`7662bcfc5ca87f56d6fe47107b10bcbfd36e08d4faad912d2ebfa48976050ae9`.
It contains the verified first-stage C, C++, JavaScript, TypeScript, Python, Go,
Rust and Solidity compilers/runtimes plus six initialized language servers.
Selecting a lease in Remote Explorer
routes the Workbench Run action through the runtime control plane, synchronizes
only the validated text workspace, and compiles or executes the active file in
that container without a shell or network device. The current candidate live
server gate creates a fresh lease, runs all nine language paths including distinct
C17 and Java adapters, verifies compiler-version evidence, exercises eight requests
across seven cloud LSP routes (including C and C++ through clangd), opens an interactive PTY inside that same
container, writes a file, synchronizes the changed text snapshot back through
the revisioned workspace store, deletes the lease and rejects any leaked runtime
container. Active terminal and LSP processes hold a lease lock, so their backing
container cannot be stopped while work is running.

Package installation is a separate lease-locked operation, not terminal or task
authority. The Web client sends one exact npm spec, an `install-package-once`
approval and bounded workspace metadata. The service rejects ranges, tags,
URLs, aliases and non-exact existing direct dependencies; creates a sanitized
manifest; and invokes npm shell-free with lifecycle scripts, audit and funding
disabled. A temporary reviewed LXD network device exists only during the
120-second install. It must be removed before success; unknown add state or
cleanup failure stops the container. An atomic, 512 MiB project store under
`/opt/ynx-code-dependencies/<project>/node` survives later tasks, which link its
`node_modules` only after resolving the owner/project lease. The returned
manifest and lockfile must still fit the shared 256-file/2 MiB text-workspace
boundary. The same one-time network capability now supports exact Python wheel
plans: source builds are rejected, an atomic project venv is persisted below the
owner/project dependency store, and pip's machine-readable install report must
bind every downloaded `.whl` to a SHA-256. The resolved `name==version
--hash=sha256:…` environment is returned as `requirements.ynx.lock`, and later
Python tasks use that venv in isolated mode only after its versions match that lock.
This does not claim Cargo, Go, Maven/Gradle or Solidity framework installation.

The next reviewed image recipe extends execution to Java with OpenJDK 21. Both
workspace-agent and LXD adapters derive the public class from the active
filename and optional declared package, compile UTF-8 bytecode only below
`.ynx-build/java`, and execute through a fixed classpath. A packaged Java program
has passed on the local network-disabled macOS sandbox. The recipe also writes
the exact installed JDK/JRE Debian package versions into the image and installs
Eclipse JDT LS `1.61.0-202607142124` only after verifying its pinned SHA-256.
The image probe requires a real JDT LS initialize exchange. Monaco and Outline
route Java completion, navigation, rename, formatting, diagnostics and symbols
through that owner/project/runtime-scoped process; its data directory is bounded
to `.ynx-build/jdtls`. This remains an undeployed candidate until a Linux LXD
builder produces a new immutable fingerprint and the nine-runtime, seven-LSP
live gate passes.

Remote SSH profiles accept public targets only on the public tier. The service
scans the host key, requires the user to approve that exact key, verifies the
private key with `BatchMode`, `IdentitiesOnly` and strict host-key checking, then
stores it as AES-256-GCM ciphertext under a server envelope key. List responses
never return host-key material or credentials. Private/loopback/link-local
targets, changed keys and unconfigured encryption fail closed. Profile creation
does not implicitly authorize terminal input, network, packages, Agent tools or
deployment; those remain separate approvals.

A saved profile can now be selected as an editable terminal workspace. The
gateway decrypts the credential only for that owner and connection, recreates
temporary `0600` identity/known-host files, synchronizes the validated text
snapshot into `.ynx-code/workspaces/<project>`, opens an interactive PTY, pulls
bounded text changes back through the revisioned workspace store and deletes the
temporary credential files. Active profiles are locked against removal and can
be opened again after exit. Host-key selection is deterministic (Ed25519,
ECDSA, then RSA) so repeated review displays the same fingerprint. The real
2026-08-10 SSH gate connected to the public candidate host, wrote a remote file,
synchronized it, advanced the workspace from revision 1 to 2, released the
profile lock and reverified the same Ed25519 fingerprint. One-click task/LSP
routing on arbitrary SSH hosts is not yet enabled because their installed
toolchains have not been attested; users must run those commands explicitly in
the remote terminal.

## 9. Debugging

The Workspace Agent hosts Debug Adapter Protocol sessions. Initial adapters are
Node.js, Python, Go and Rust/C++ via reviewed adapters. Breakpoints are persisted by
workspace-relative path and source revision. DAP traffic is validated and
bounded; adapter `runInTerminal` requests return to the permission broker.
Variables, watches and evaluations are scoped to a paused session. Debugging a
remote or chain transaction uses a separate read-only transaction debugger.

The first adapter gates are implemented for Node.js, C/C++, Python, Go and Rust in
`services/debug-service`. C/C++ builds the selected source with debug symbols
and launches LLDB DAP in the default-deny-network sandbox. Python requires the
selected owner/project-bound LXD lease and launches the SHA-pinned debugpy
runtime inside that container; its internal loopback remains available while
the container has no external network device. Rust compiles with debug info in
the same lease and starts the pinned Ubuntu `lldb-dap-18`. Go starts pinned
Delve 1.25.2 through a reviewed stdio bridge; the bridge chooses a fresh
container-loopback port per session and Delve never receives an external NIC.
Node.js uses the SHA-256-pinned Microsoft js-debug 1.117.0 standalone server;
its bounded bridge handles the adapter's child DAP session over per-session
Unix sockets, reapplies only the already-approved breakpoint set and disables
automatic child-process attachment. All routes rewrite
source and program paths to the owned workspace and allow only a bounded DAP request set.
The workbench exposes gutter breakpoints, continue/step controls, call stack,
variables and the current stopped line. A real debugpy gate hits line 2 and
reads `value = 7`; the protected live-container gate repeats that sequence and
requires a Rust line-3 breakpoint with `value = 9` in the published image.
The same protected gate requires a Go line-5 breakpoint with `value = 11`.
It also requires a Node line-3 breakpoint with `value = 13`. Executing the
target-Ubuntu Rust/Go/Node gates remains an explicit acceptance gap.

## 10. Git and review

Git runs through the Workspace Agent with exact repository root. Status, diff,
stage, commit, branch and merge are local workspace operations. Fetch/pull/push
require network approval; credentials are opaque secret references. Pull-request
creation is a provider adapter action with preview and explicit approval.
Destructive Git operations are separately classified and never issued by an AI
agent without an exact user approval.

The Git gate persists a bare object database per signed owner and project in
`services/git-service`. Status, working/staged diff, stage, unstage, 50-entry
commit history, identity-explicit commits and local branch create/switch/delete/
merge are real Git operations executed inside the default-deny-network sandbox.
Checkout and merge use exact revision plus idempotency protection when replacing
the authoritative text snapshot. Persistence failure rolls repository state
back, while conflicts are enumerated and aborted without changing that snapshot.
Hooks, global/system configuration, external diffs, interactive credential
prompts and GPG signing are disabled.

Remote pull, push and PR intent can be validated and hashed for review, but the
current broker does not execute it and performs no preview-time network request.
Only credential-free HTTPS public-host URLs pass validation; browser credentials,
embedded URL credentials, local/private targets and SSH URLs fail closed. Real
execution remains gated on an approved server-side credential/provider broker
with one-time approval and auditable result evidence.

## 11. Extension system

Extensions use versioned manifests, declared contributions and capability
permissions. Supported contribution points include languages, grammars, themes,
commands, views, LSP/DAP/toolchain adapters, agent tools and blockchain
templates. Web extensions execute in a worker sandbox; runtime extensions run
in a restricted extension-host process. No extension receives filesystem,
process, network, secret or Wallet access by default.

The implemented gate is `declarative-web` only. The per-owner SQLite registry
validates bounded language suffixes, Monaco snippets and theme tokens, stores a
canonical manifest with SHA-256 identity, and supports install/update,
enable/disable and one-time-confirmed uninstall. State changes require the exact
installed digest so a stale tab cannot mutate a newer version. The workbench
applies contributions only while an extension is enabled and identifies every
entry as local-manifest / validated-declarative-only. Executable Web Workers,
runtime code, VSIX import, marketplace trust and privileged contributions remain
disabled until their separate isolation/signature gates;
the manifest installer states that boundary explicitly.

Install records bind publisher, package digest, signature/provenance, permissions,
compatibility and vulnerability result. Revocation disables an extension before
its next activation. VS Code-compatible manifests may be imported only through
an explicit compatibility adapter; compatibility is measured extension by
extension and never claimed universally.

## 12. Autonomous software engineer

The orchestrator is a durable state machine, not a chat completion:

`intent -> plan -> context approval -> explore -> propose diff -> review -> test
-> build -> fix -> package -> deployment review -> checkpoint -> apply/revert`

Roles are isolated executions over one shared run ledger:

- Planner creates bounded tasks and success tests.
- Coder proposes file operations and commands.
- Reviewer evaluates diff, architecture, security and requirement coverage.
- Tester runs approved test/build actions and attaches raw evidence.
- Deployment Agent prepares a release/deployment intent but cannot sign it.

The first server-side Agent gate is implemented in
`services/agent-orchestrator`. Planner output is schema-validated and must be
approved before exact context paths are captured. Coder output uses compact,
structured find/replace operations bound to the approved file's SHA-256 digest;
the server requires each source fragment to match exactly once before it
materializes the full reviewable file. The Planner may separately suggest new
paths; the user must approve each exact path, and the server rejects existing
paths, file-parent collisions, duplicates, unapproved output and oversized
content before a create operation enters the reviewable proposal. Deletes also
require an exact approved existing path and captured SHA-256. Apply removes the
file but persists its content/digest in owner-scoped run trash; a separate
`restore-once` grant and unchanged revision restore it in a new workspace
revision. Irreversible deletion remains disabled. A separate Reviewer decision is required,
and apply requires an explicit `write-once` approval plus the unchanged captured
workspace revision. Runs and events persist in SQLite WAL with a SHA-256 hash
chain. After apply, the Tester can run one explicitly selected supported entry
file through the same bounded runtime with an `execute-once` approval; its raw
compiler/runtime result and sandbox metadata are appended to the audit chain.
Reviewer-blocked proposals can be regenerated against the exact findings
without widening the approved file set. Failed Tester evidence can likewise
produce a new digest-bound fix, but every revision is reviewed and needs a new
write approval. Role responses use JSON mode, role-specific output ceilings and
strict schema validation; harmless model formatting is normalized only when it
resolves to one unique already-approved path.
After a passing Tester event for the current revision, the Deployment Agent can
prepare a deterministic review artifact containing the target, exact file
digests/byte counts and the Tester event hash. Preparing and approving that
artifact are separate state transitions; approval requires the one-time
`deployment-review-once` token. Both states are marked `executable: false` and
the broker performs no network, signing, publishing or transaction action.
Model events also retain provider/model, provider-reported token counts and
duration. Cost is `unreported-by-provider` until the provider supplies accepted
cost evidence; the UI does not invent an estimate. Package installation,
browser-network, remote Git and actual deployment tools stay disabled until
each permission adapter passes its own gate.

The same passing Tester evidence may instead produce a local Git review. The
artifact binds project/workspace revision, current local branch and HEAD, exact
commit message, every changed path with operation/SHA-256/byte count, and the
Tester event hash. A changed repository or workspace invalidates the preview.
Only `git-local-commit-once` can call the owner-isolated Git broker to initialize
when needed, stage those exact reviewed paths and create one local unsigned
commit with hooks and prompts disabled. Revalidation, staging and commit share
one owner/project broker lock, closing the inter-request TOCTOU window. The resulting commit hash is appended
to the Agent hash chain. Pull, push, PR creation, credentials, signing and all
Git network access remain a separately disabled `git-remote` permission.

Tools are versioned: `read_file`, `write_file`, `edit_file`, `delete_file`,
`search_code`, `terminal`, `git`, `browser` and `deploy`. Each call binds run,
tenant, workspace revision, arguments, permission class, preview, approval,
result digest and audit ID. Read context uses an allowlist. Writes apply as a
reviewable patch. Execute/network/package/secret/Git/deploy permissions are
separate, short-lived and revocable. Subagents cannot widen parent authority.
The implemented Agent matrix currently grants context read, model-network,
workspace write, test/build execution, local Git commit and deployment review. Each grant requires
a scope token plus an owner-scoped UUID that is atomically consumed in SQLite;
reuse is rejected across actions and runs. Grant and denial decisions enter the
same hash-chained run ledger. Package install, remote Git, browser network,
secret-reference, destructive delete and deployment execution are visibly
  disabled until their own adapters and recovery gates exist. Recoverable delete
  and restore are workspace-write capabilities; destructive delete remains a
  separate disabled permission.

## 13. Model router and project memory

The Model Router supports managed and bring-your-own providers. Managed policy
may select OpenAI, Anthropic, Google, xAI or reviewed local Qwen/Llama/DeepSeek
models based on task capability, data policy, latency and cost. The UI shows the
actual provider/model/cost state. BYO secrets stay in the secret broker and are
never written to project files, browser storage, prompts or logs.

`services/model-router` implements the first fixed-endpoint provider boundary:
the existing loopback-hosted Qwen service plus request-only OpenAI Responses,
Anthropic Messages, Google Gemini generateContent and xAI Chat Completions
adapters. Provider/model identifiers, request/context/output sizes, timeouts,
concurrency and queues are bounded. Arbitrary provider URLs are rejected and
credentials are excluded from returned results and the Agent ledger. Llama and
DeepSeek remain supported model families, not advertised hosted instances,
until an operator configures and health-checks reviewed local deployments.

The current Linux candidate gate uses hosted `qwen3:8b` for structured coding
roles. On 2026-08-09 a fresh C++ workspace completed Planner, Coder and Reviewer,
then applied one approved patch and compiled/executed it with
`x86_64-linux-gnu-g++-13` inside the `linux-bubblewrap-prlimit` network-disabled
sandbox. The program emitted `2` and the run persisted seven hash-linked audit
events. `qwen2.5:1.5b` failed the coding-quality gate and is not a coding default;
`qwen3:14b` exceeded the acceptable CPU-only interactive latency and is reserved
for an explicitly selected deep task until accelerated capacity exists.

The target project-memory model includes a versioned symbol/reference graph,
architecture facts, API schemas, decisions, test history and user-approved
preferences. The current implementation now covers deterministic source
declarations and resolvable workspace-file imports, but does not claim AST/LSP
references, API call graphs, architecture decisions, history or preferences.
Embeddings store chunks with tenant, repository, revision, path and ACL.
Retrieval must pass tenant and file authorization before scoring. Deletion
removes derived chunks and vector entries; rebuild is deterministic from the
current workspace snapshot.

The first real vector-memory gate is implemented in `services/project-memory`.
It chunks only the signed owner's current workspace revision, obtains bounded
embeddings from a fixed-loopback `nomic-embed-text` runtime, stores content,
digest, vector, revision and ACL scope in SQLite WAL, and performs bounded cosine
ranking after tenant/project filtering. Re-index reuses unchanged digest vectors
and replaces the previous revision transactionally, so deleted chunks cannot
survive. The Coder may retrieve only paths explicitly approved in the Agent
context step; cross-owner and non-approved retrieval are filtered before vector
scoring. The UI exposes view, incremental rebuild, semantic search, paginated
JSON export and one-time-confirmed clear. Its bounded facts view marks each file
relation with a concrete target or an explicit external/unresolved state. Export pages bind to one indexed
revision to avoid mixed-generation archives. Retention is truthfully reported as
one current index with no automatic expiry; rebuild and user clear are its
deletion triggers. Source workspace files are not deleted by memory clear.

The same transaction now rebuilds a bounded `memory_facts` index. It records a
language-classified file fact, declaration name/kind/line facts and import/use/
include facts for JavaScript, TypeScript, Python, Go, Rust, C/C++, Java and
Solidity. Relative relations are marked resolved only when a concrete path
exists in the same owner/project snapshot; external packages remain named but
unresolved. Fact and chunk exports paginate independently while binding the same
revision. `memory_indexes` preserves explicit current-revision metadata even for
empty files and is backfilled from legacy chunk databases. Rebuild and clear
replace/remove chunks, vectors, facts and revision metadata in one transaction.

## 14. Collaboration

Text collaboration uses a CRDT document per file with revision checkpoints.
Presence, selections and cursors are ephemeral. Workspace ACL roles are owner,
editor, terminal collaborator, reviewer and viewer. Shared terminal input is
off by default and transfers through an explicit floor/permission action. Chat
and audit are separate from source text. Every collaborator still needs a
canonical YNX Product Session; invite links alone grant no access.

The candidate collaboration service now uses Yjs documents behind a bounded,
same-origin WebSocket gateway. Workspace owners create opaque room IDs and
single-use, expiring invitation tokens; redemption binds an authenticated
subject to `editor`, `reviewer`, `viewer` or `terminal` ACL state in SQLite WAL.
Editors and owners may merge existing-file edits and CRDT-backed file
create/remove operations. Reviewers/viewers cannot mutate the document.

Durable ACL membership is distinct from ephemeral online presence. Owners can
list granted subjects and issue a separately confirmed revoke. The service
deletes the ACL row before notifying and closing every matching live socket with
code 4003, and it revalidates ACL role on every message to close race windows.
Clients retry transient disconnects after 1.5 seconds only after an authenticated
HTTP access check; revoked clients clear their stored room rather than retrying.
Terminal-role invitations do not grant terminal input in this checkpoint. A
separate shared-terminal floor/approval protocol remains required and the UI
states that terminal input is off by default.
Presence and cursors are ephemeral, room chat is a separate message channel,
and a shared document changes the canonical workspace only through an explicit
revision-checked checkpoint. CRDT state and workspace revisions survive service
restart. Limits currently enforce 256 global sockets, 32 per room, 128 KiB
updates, 256 files and 2 MiB text workspaces; cross-origin sockets, replayed
invitations, unauthorized root types and stale checkpoints fail closed. The
React workbench exposes share/join/invite, participants, chat and checkpoint
controls, synchronizes Monaco file state through Yjs, and switches reviewer or
viewer editors to read-only. Shared terminal input remains separately gated and
off. The candidate still uses the existing signed workspace session; public
release remains blocked until ingress uses the canonical YNX Product Session.

Candidate dependency installation is fail-closed through
`scripts/install-reviewed-dependencies.sh`: lockfile dependencies are installed
with lifecycle scripts disabled, then only the exact, reviewed `node-pty`
package is rebuilt for the host platform. This preserves the real PTY without
allowing arbitrary transitive install hooks.

## 15. YNX Chain development

The first live blockchain slice routes a signed workspace session through the
same-origin gateway to a dedicated Chain service. The service has a fixed
canonical HTTPS Testnet upstream, strict response/time/concurrency bounds and no
caller-controlled upstream URL. It normalizes network status, joins Explorer
records to EVM transactions and receipts, resolves blocks, exposes compiler
metadata and permits only reviewed read-only JSON-RPC methods. Signing and
mutating RPC methods are rejected.

The React Chain workbench shows the live chain identity, height, validator and
pending state; provides block/transaction debugging and reviewed JSON-RPC
inspection; and can insert Counter, DataAnchor or BatchPayment Solidity
templates into the current project. The canonical compiler endpoint currently
identifies Solidity 0.8.24 but declares production compilation disabled, so the
workbench does not describe that metadata endpoint as an authoritative
production compiler.

Wallet integration is an exact transport boundary in this slice. The ordinary
Web workbench cannot receive the registered
`ynxdeveloper://wallet-auth/callback`, so it sends the user to the canonical
Wallet/install surface and never creates a browser session. A reviewed desktop
bridge may generate the canonical five-minute `ynxwallet://authorize` request
using its compressed P-256 product-device key and open Wallet, but the result is
only `wallet-review-opened` until the callback passes. The current macOS source
can complete the callback and product-device challenge, but the server still
requires deployed central Gateway proof before it will return a Product Session.
Intent, simulation, signing, broadcast, receipt and Explorer-source verification
remain separate gates. Browser-injected providers, private-key input and
mnemonic input are rejected. The reviewed desktop source implements the first
six gates: it creates an exact artifact-bound request, Wallet signs the canonical
Go-compatible `application_action`, and the Developer service re-introspects the
live `developer:deploy` Product Session before accepting the exact Wallet bytes.
Public submission remains fail-closed behind the independent
`YNX_CODE_IDE_ACTION_PUBLIC_READY` operations gate.

The Gateway exposes `/runtime/wallet/readiness` only to a signed workspace
session. A dedicated broker probes the fixed loopback canonical Wallet Gateway
with per-owner/global concurrency, timeout and response-size limits. Health or
runtime readiness alone cannot enable Developer: the authoritative version must
also list `ynx-developer-v1` in `enabledProductClientIds` and expose a canonical
64-hex `registrySha256`. Older healthy builds remain visibly closed.

On the macOS desktop profile, the Developer product device is a non-extractable
P-256 `CryptoKey` persisted in the WebKit origin's IndexedDB. The public half is
exported only as canonical compressed SEC1 base64url for the authorization
request. Native code validates and opens the exact `ynxwallet` route; the app is
registered for `ynxdeveloper://wallet-auth/callback` and rejects callback route,
fragment, and field widening before delivering the URL to the workbench. This
transport binds the response to the pending request, creates a 90-second challenge
and signs it with the non-extractable key. The signed-workspace server route again
checks `remoteDeployed`, `publicDeploymentReady` and the exact registry attestation
before forwarding canonical completion JSON to the fixed loopback Gateway. Only
the Gateway's verified session result changes the UI to authenticated; deployment
does not follow automatically. Every deployment requires a fresh Wallet review.
The callback is bound to the pending session, account, artifact and request. The
server recomputes the payload hash, IDE request hash, artifact digest and
transaction hash, rejects field widening, submits the unmodified Wallet byte
sequence only to the BFT Gateway's dedicated `/ide/deploy` route,
and reports success only after an authoritative status `0x1` receipt
with a block number. A hash without that receipt stays pending.

Later blockchain slices add reviewed Rust contract profiles, Move and Cosmos SDK,
pinned dependency/toolchain manifests, local tests, Testnet simulation, gas/fee
estimates, contract artifacts, source maps and verified Explorer links.

The current workbench now exposes dependency-free Rust, Move and Cosmos SDK
project profiles with explicit capability labels. Rust is an editable profile
that requires a separately reviewed target toolchain; Move is editing-only; the
Cosmos profile is a compilable plain-Go message shape but is not a generated SDK
module. These profiles cannot raise build, simulation or deployment state merely
because their files were inserted.

Deployment state is:

`built -> tested -> simulated -> wallet_review -> signed -> broadcast -> receipt
-> explorer_verified`

The intent binds chain/network, account, artifact hash, compiler and source hash,
constructor/method arguments, value, gas/fee bounds, simulation digest, nonce and
expiry. Only YNX Wallet signs. Failure or expiry cannot be converted to success
by the IDE.

## 16. Security boundaries

- Canonical Wallet Product Sessions at ingress; no browser bearer fallback.
- One tenant/workspace runtime boundary; no shared writable host checkout.
- Rootless containers, read-only base image, seccomp/AppArmor, cgroup limits,
  bounded tmpfs and default-deny egress.
- Secret broker returns scoped handles; processes receive a secret only for an
  approved action and logs pass through redaction.
- Package install uses lockfile diff, registry allowlist, provenance, license and
  vulnerability preview before execution.
- Extensions and agent tools are signed, permissioned, revocable and audited.
- Build artifacts receive digest, SBOM, provenance and source revision.
- SAST, dependency, secret and container scans are release gates.

Threats tracked explicitly include workspace escape, cross-tenant IDOR, command
injection, malicious language server/extension/package, prompt injection,
approval replay, secret exfiltration, terminal hijack, CRDT authorization drift,
Git credential leakage, deployment substitution and supply-chain rollback.

## 17. Scale and reliability

One million registered users is not a single-server claim. The capacity design
uses regional stateless gateways, sharded workspace placement, queue partitioning,
autoscaled runtime pools, durable object/project storage and independently scaled
LSP/index/agent/model/collaboration services.

Initial SLO candidates (not achieved until measured):

- control-plane availability 99.9% monthly Testnet candidate;
- workspace attach p95 below 3 s warm / 20 s cold;
- file mutation p95 below 250 ms in-region;
- terminal echo p95 below 150 ms in-region;
- editor local input never waits on the network;
- task output loss: zero acknowledged frames, resumable cursor;
- RPO 5 min and RTO 30 min for durable project metadata;
- per-runtime and per-tenant quotas with admission control, bounded queues and
  overload responses instead of resource collapse.

Capacity is reported as measured concurrent sessions, active runtimes, file ops,
PTY streams, LSP messages, agent runs and model tokens. A 100-user probe cannot
support a million-user claim; staged load, failure injection and regional soak
evidence are required.

## 18. Migration and delivery phases

1. **Foundation:** versioned protocol, React workbench, Monaco models, real file
   API, C++ compile/run, task stream, workspace isolation and recovery.
2. **Language platform:** seven first-stage toolchains, LSP tunnel, search,
   formatting, test discovery and artifacts.
3. **Engineering platform:** PTY terminal, Git, DAP, extension host, CLI and
   desktop brokers.
4. **AI software factory:** orchestrator roles/tools, permissions, model router,
   project memory and evidence-bound loops.
5. **Cloud and collaboration:** container scheduler, remote workspaces, CRDT,
   presence, shared terminal permissions and multi-tenant capacity tests.
6. **Web4 release:** YNX templates, Wallet-only deployment, Explorer verification,
   multi-platform packaging and public evidence.

Each phase requires tests, performance evidence, threat-model delta, migration/
rollback notes, operations update and machine-readable release truth. The legacy
surface remains the rollback target until Foundation parity is proven.
