# YNX Developer user guide

Create or import a bounded local project, choose a file, edit and save, then run
the pinned compile action. Output is authoritative only when it contains the real
chain response. Tests/tasks show their command, directory, environment class and
risk before an installed desktop executor can run them.

Open **Settings** from the bottom of the activity bar to change editor font size,
minimap, word wrap, auto-save and its delay. These preferences are stored only on
the current device. When auto-save is off, use **Save** or `Ctrl/Cmd+S`; the save
still goes through the revision-checked workspace service and reports conflicts.

Open **Search** to find matching lines across the project. Enter replacement text,
choose whether case must match, review the exact match and file counts, then use
**Replace all**. The operation asks for confirmation, marks every changed file as
unsaved and follows the normal auto-save/manual-save and Workspace History path.
Search and replacement are literal; text such as `.` or `$&` is not interpreted
as a regular expression or replacement command.

Explorer provides **Import project JSON**, **Import folder** and **Export project
JSON** actions. Both imports ask before replacing the current project and accept
at most 256 valid UTF-8 text files within 2 MiB; unsafe or duplicate relative
paths fail without changing the project. JSON exports use the versioned
`ynx-code-project/v1` schema and include all current text files. Directory import
does not preserve binary content, symlinks, empty directories, permissions or
executable bits. Imported changes are saved and recovered like editor changes.

Use **Test** beside Run when the workbench discovers supported test files. Review
the exact list, then approve that test run once. YNX Code runs `.test.js`/`.spec.js`,
Python unittest `test_*.py`/`*_test.py`, Go `_test.go` files with their same-directory Go
sources, standalone C/C++ files under `test/` or `tests/`, dependency-free Rust
projects with inline `#[test]` functions, JUnit Jupiter
`*Test.java`/`*Tests.java` files under `src/test/java/`, and Solidity `.t.sol`
contracts containing `test*` functions. Network stays off and
the server never runs a `package.json` script. Cargo runs `--offline --locked`
and accepts only the bounded dependency-free package manifest and canonical
lock. Solidity tests run with Hardhat `3.9.0` and a SHA-verified solc `0.8.24`
WASM compiler; workspace Hardhat configuration, plugins and package scripts are
not executed.

Open **Problems** in the bottom panel to inspect current diagnostics returned for
opened files. Entries show severity, message, source, code and exact line/column;
select one to open its file. Editing the diagnosed content invalidates its old
entry until the language server responds again. An empty panel can also mean the
language server for that file is not installed, so it is not proof that every
project file passed analysis.

The breadcrumb above the editor shows the active workspace and file path. Open
**Outline** from the activity bar to request the current file's symbols from its
configured language server. Select a class, function, method, variable or other
returned symbol to open that file and focus its exact source location. Outline
refreshes after content edits; an empty view may mean the server returned no
symbols or that the required language server is unavailable.

The editor recognizes common source extensions through Monaco. The isolated
workspace uses its reviewed pinned Solidity 0.8.36 compiler. For other registered languages, Compile asks once and the
desktop runtime detects a broad catalog including C/C++, Objective-C, JavaScript,
TypeScript, Python, Java, Go, Rust, .NET languages, Dart, JVM languages, Ruby,
PHP, Swift, functional languages, systems languages and common shells, then runs
the matching real locally installed toolchain without network access
inside the bounded project workspace. Availability is reported per device; an
editor language is never presented as a working compiler merely because it has
syntax colors. Add language pack accepts declarative JSON for file extensions,
keywords and completion only. It stores the pack locally and never executes pack
code. Executable adapters remain reviewed and allowlisted.

Open **Extensions** in the activity bar to see these layers separately. Built-in
editing languages, current-profile language packs, built-in compiler adapters and
current-user compiler adapters are listed independently. A ready compiler entry
means the exact executable was detected on this device; a language entry alone
never means Compile is available. Custom language packs and compiler adapters can
be removed from this view. A reviewed custom adapter may override the selected
compiler for a built-in extension; removing it restores the built-in adapter.

The editor can recognize an open-ended set of languages, while every executable
language requires a real toolchain. This follows the VS Code model: editing
extensions and compiler/runtime installation are independent. YNX Developer does
not claim that every compiler is preinstalled. To add another language, install
its compiler for the current user, then import a reviewed adapter manifest that
maps safe extensions to that executable. Missing tools remain visibly unavailable;
they are never reported as successful compilation.

Select a project-bound LXD workspace in **Remote Explorer**, then choose
**Package** beside Run/Test to install one exact npm dependency such as
`kleur@4.1.5`, or choose Python and install an exact package such as
`colorama==0.4.6`. Review the command and existing lock before approving. npm
dependencies must use exact versions; its lifecycle scripts, audit and funding
calls are disabled. Python accepts only an exact `name==version`, rejects source
distributions/builds with `--only-binary=:all:`, persists an atomic project venv,
and writes its exact resolved environment plus each downloaded wheel's SHA-256
to `requirements.ynx.lock`. A missing or malformed pip integrity report fails
before the environment is switched into use. The
temporary install network must be removed before either operation succeeds.
The service links only that project's persisted dependency store into later
tasks. The action is unavailable for the local ephemeral Web sandbox and SSH
profiles; use the explicitly opened SSH terminal under that host's own policy.
Cargo, Go, Maven/Gradle and Solidity package installers do not yet have reviewed
Web buttons.

The packaged desktop product separately supports an exact project-local npm
install. Its TypeScript adapter can use a reviewed `typescript@5.9.0` package
without adding a global executable.

Open **Workspace History** to inspect the latest 50 server-local project
revisions. **Export** downloads the selected complete revision as JSON. **Restore**
shows the source and current revisions for confirmation, rejects concurrent
changes, and creates a new revision containing the selected files; it does not
erase retained history. Export important revisions elsewhere because this
same-server history is not an off-device or disaster-recovery backup.

Open **YNX Chain** in the activity bar to inspect the live Testnet without
leaving the workspace. Refresh network status, find a transaction hash or block
height/hash, or run one of the listed read-only JSON-RPC methods. The panel joins
Explorer transaction records with the authoritative EVM transaction and receipt
when all are available. It cannot send a transaction through raw RPC.

The Contract templates create editable project files; inserting a template does
not compile, deploy or prove a contract. Run a Solidity source to create ABI,
bytecode, source-map metadata and `.ynx-build/manifest.json`; the workbench
recomputes every returned SHA-256 before saving these files. This build manifest
is necessary deployment input, not evidence that a transaction was submitted.
**Estimate deployment gas** sends only the verified creation bytecode to the
read-only `eth_estimateGas` path and combines it with the current `eth_gasPrice`.
It is an RPC estimate, not execution simulation, balance reservation or a fee
guarantee; Wallet must show the final bounds again before signing.
Rust, Move and Cosmos SDK starters are labelled by their exact capability. The
Rust starter is dependency-free and becomes locally testable only with its
reviewed target toolchain. Move remains editing-only until a YNX-compatible Move
runtime is attested. The Cosmos starter contains a dependency-free message type;
it is not a generated or running Cosmos SDK module. Template insertion never
raises compiler, runtime or deployment status.
The Chain panel's displayed 0.8.24 compiler value is
the canonical Testnet compiler metadata and is not a production-compilation
claim while that endpoint reports production compilation disabled. The Web
surface cannot receive the registered native Developer callback. Its Wallet
link is an installation handoff, not login. A reviewed desktop transport may
open the exact five-minute Wallet request, but no session exists until callback
verification and central Gateway completion both pass. Signing and deployment
stay unavailable until the complete signed receipt flow passes its release
gates.

YNX AI Build starts with Preview plan. Select only the files the provider may
see, review the estimate and provider status, approve one network request, then
review any proposed diff. Applying a diff needs a separate one-time write grant
and creates a recoverable checkpoint. Use Audit to export the run record.

Deployment is Wallet-only. Compile first. In an installed, reviewed desktop
Developer client, open the canonical Wallet request and complete the registered
callback and central Product Session. Then review the exact deployment intent,
authorize it in Wallet, and separately approve network submission. These later
steps are implemented in reviewed desktop source but remain unavailable on the
public surface until both the Wallet Gateway and IDE application-action gates
pass. Wallet shows the exact contract, arguments, artifact, simulation, fixed
one-YNXT fee, account, nonce and expiry before signing. A transaction hash is
pending, not success; Developer confirms only a successful receipt with a block
number. Inspect Receipts & logs for the authoritative receipt and source-match
boundary. Never enter a private key, mnemonic or deployment signer in Developer.
