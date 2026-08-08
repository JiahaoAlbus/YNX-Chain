# YNX Developer user guide

Create or import a bounded local project, choose a file, edit and save, then run
the pinned compile action. Output is authoritative only when it contains the real
chain response. Tests/tasks show their command, directory, environment class and
risk before an installed desktop executor can run them.

The editor recognizes common source extensions through Monaco. Solidity uses the
public pinned compiler. For other registered languages, Compile asks once and the
desktop runtime detects an installed C, C++, JavaScript, Python, Java, Go, Rust,
Ruby, PHP, Swift, Kotlin or Shell toolchain, then runs it without network access
inside the bounded project workspace. Availability is reported per device; an
editor language is never presented as a working compiler merely because it has
syntax colors. Add language pack accepts declarative JSON for file extensions,
keywords and completion only. It stores the pack locally and never executes pack
code. Executable adapters remain reviewed and allowlisted.
TypeScript is the first project-installable compiler adapter: install the exact
reviewed `typescript@5.9.0` package through the package approval flow, then
Compile uses that project-local compiler without adding a global executable.

YNX AI Build starts with Preview plan. Select only the files the provider may
see, review the estimate and provider status, approve one network request, then
review any proposed diff. Applying a diff needs a separate one-time write grant
and creates a recoverable checkpoint. Use Audit to export the run record.

Deployment is Wallet-only. Compile first, sign in through canonical YNX Wallet,
review the exact intent, authorize in Wallet, and separately approve the network
submission. A transaction hash is pending, not success. Inspect Receipts & logs
for the authoritative receipt and source-match boundary. Never enter a private
key, mnemonic or deployment signer in Developer.
