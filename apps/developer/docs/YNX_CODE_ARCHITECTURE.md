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

## 6. Editor engine

Monaco owns one model per canonical file URI. The workbench implements:

- multi-select explorer operations and native keyboard naming flow;
- preview/pinned tabs, dirty markers, close/reopen and hot exit;
- horizontal/vertical editor groups with independent selections;
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

## 8. Tasks, terminal and process supervision

Terminal transport uses a PTY only inside the selected runtime. The process
supervisor owns PID, process group, cwd, environment allowlist, CPU/memory/PID/
disk/time limits and cancellation. Output is streamed with ordered sequence IDs,
bounded replay and truncation markers. Browser disconnect does not orphan a
process; the runtime policy decides continue, pause or cancel.

The current foundation implements this boundary through
`services/terminal-service`: a same-origin, signed-session WebSocket upgrades to
an actual `node-pty` shell inside the existing macOS `sandbox-exec` or Linux
Bubblewrap/prlimit workspace. It enforces per-owner/global session ceilings,
input and resize bounds, idle/hard lifetime cleanup, default-deny network and
revision-checked text snapshot synchronization. Task output remains a separate,
non-interactive terminal surface. Shared terminal resume, object-store-backed
runtime volumes and audited Docker/SSH profiles remain gated and are not
represented as available.

Tasks are declarative records (`command`, argument array, cwd, environment class,
problem matcher, timeout, network policy and artifact outputs). Shell parsing is
not used for generated tasks. Interactive terminals may use a shell after the
user explicitly starts one. Docker and SSH are capabilities, not implicit host
access: Docker targets a workspace runtime; Remote SSH requires a user-owned
connection profile and host-key review.

## 9. Debugging

The Workspace Agent hosts Debug Adapter Protocol sessions. Initial adapters are
Node.js, Python and Rust/C++ via reviewed adapters. Breakpoints are persisted by
workspace-relative path and source revision. DAP traffic is validated and
bounded; adapter `runInTerminal` requests return to the permission broker.
Variables, watches and evaluations are scoped to a paused session. Debugging a
remote or chain transaction uses a separate read-only transaction debugger.

The first actual adapter gate is now implemented for C/C++ in
`services/debug-service`. It builds the selected source with debug symbols,
launches LLDB DAP inside the same default-deny-network sandbox, rewrites source
and program paths to the owned workspace, and allows only a bounded DAP request
set. The workbench exposes gutter breakpoints, continue/step controls, call
stack, variables and the current stopped line. Target-Ubuntu evidence must hit
a real source breakpoint and return its stack frame; Node.js, Python and Rust
remain gated until their separate adapters pass the same test.

## 10. Git and review

Git runs through the Workspace Agent with exact repository root. Status, diff,
stage, commit, branch and merge are local workspace operations. Fetch/pull/push
require network approval; credentials are opaque secret references. Pull-request
creation is a provider adapter action with preview and explicit approval.
Destructive Git operations are separately classified and never issued by an AI
agent without an exact user approval.

The current first Git gate persists a bare object database per signed owner and
project in `services/git-service`. Status, working/staged diff, stage, unstage,
commit history and identity-explicit commits are real Git operations executed
inside the default-deny-network sandbox. Hooks, global/system configuration,
external diffs, interactive credential prompts and GPG signing are disabled.
Branch creation/switch/merge, remotes and pull-request providers remain gated;
the UI does not claim them yet.

## 11. Extension system

Extensions use versioned manifests, declared contributions and capability
permissions. Supported contribution points include languages, grammars, themes,
commands, views, LSP/DAP/toolchain adapters, agent tools and blockchain
templates. Web extensions execute in a worker sandbox; runtime extensions run
in a restricted extension-host process. No extension receives filesystem,
process, network, secret or Wallet access by default.

The implemented first gate is `declarative-web` only. The per-owner SQLite
registry validates bounded language suffixes, Monaco snippets and theme tokens,
stores a canonical manifest with SHA-256 identity, and supports install/update/
uninstall. The workbench applies those contributions immediately. Executable
Web Workers, runtime code, VSIX import, marketplace trust and privileged
contributions remain disabled until their separate isolation/signature gates;
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
approved before exact context paths are captured. Coder proposals contain full,
bounded workspace-relative files; a separate Reviewer decision is required;
and apply requires an explicit `write-once` approval plus the unchanged captured
workspace revision. Runs and events persist in SQLite WAL with a SHA-256 hash
chain. Execute, Tester evidence, package, Git, browser and deployment tools stay
disabled until each permission adapter passes its own gate; the UI does not
describe those stages as completed.

Tools are versioned: `read_file`, `write_file`, `edit_file`, `delete_file`,
`search_code`, `terminal`, `git`, `browser` and `deploy`. Each call binds run,
tenant, workspace revision, arguments, permission class, preview, approval,
result digest and audit ID. Read context uses an allowlist. Writes apply as a
reviewable patch. Execute/network/package/secret/Git/deploy permissions are
separate, short-lived and revocable. Subagents cannot widen parent authority.

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

Project memory contains a versioned symbol/reference graph, architecture facts,
API schemas, decisions, test history and user-approved preferences. Embeddings
store chunks with tenant, repository, commit/revision, path and ACL. Retrieval
must pass tenant and file authorization before scoring. Deletion removes source,
derived chunks and vector entries; rebuild is deterministic from the project.

## 14. Collaboration

Text collaboration uses a CRDT document per file with revision checkpoints.
Presence, selections and cursors are ephemeral. Workspace ACL roles are owner,
editor, terminal collaborator, reviewer and viewer. Shared terminal input is
off by default and transfers through an explicit floor/permission action. Chat
and audit are separate from source text. Every collaborator still needs a
canonical YNX Product Session; invite links alone grant no access.

## 15. YNX Chain development

The blockchain workbench provides reviewed templates for Solidity, Rust contract
profiles, Move and Cosmos SDK, pinned dependency/toolchain manifests, local
tests, Testnet simulation, gas/fee estimates, contract artifacts, source maps,
Explorer links and transaction debugging.

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
