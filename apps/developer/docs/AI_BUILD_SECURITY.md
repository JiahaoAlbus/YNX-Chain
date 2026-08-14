# YNX AI Build security model

YNX AI Build is a permissioned engineering workflow, not an autonomous release
principal. Its state machine is implemented in `packages/developer-client` and
keeps the provider adapter below the product permission layer.

## Workflow and approvals

The persisted lifecycle covers intent, plan, plan review, explore, context
selection, edit, diff review, test, build, fix, package, deploy review,
checkpoint, revert and audit. A run can pause, resume, cancel, fail and recover.
Writes require an approved plan, approved existing-file read paths, exact new
file paths, a reviewed diff and one-time write permission. A create path must
not exist or collide with a file parent. A delete must name an approved existing
file and match its captured digest; its content is retained in owner-scoped
trash. Restoring requires a fresh one-time grant and unchanged workspace
revision. Irreversible delete remains disabled.
Test/build execution, network, package install,
secret-reference, local Git commit, remote Git and deployment are separate permissions.
Every implemented grant combines its scope token with a caller-generated UUID.
The broker atomically consumes that UUID in the owner-scoped SQLite approval
ledger, records granted and denied decisions in the run hash chain, and rejects
reuse even across permission classes or runs. The UI exposes the current matrix;
local Git commit is available only after passing Tester evidence, a digest-bound
preview and a fresh `git-local-commit-once` grant. Package install, remote Git,
browser-network, secret-reference, destructive-delete and deployment-execution
authority remain disabled. One-time grants cannot be reused.

## Data boundary

- Only user-checked project paths can enter the provider request.
- Context, prompt and language are sent in a bounded POST body; never a URL.
- Provider tokens are session-only and are not persisted or exported.
- The default managed provider is an operator-hosted Ollama model on loopback.
  Public clients never receive model-host credentials. The service exposes two
  active generations and a bounded queue of 32 instead of starting unbounded
  model processes.
- Bring-your-own-key mode accepts only the reviewed `openai` and `xai`
  providers. Their HTTPS origins are fixed in server code; clients cannot
  supply an arbitrary URL. The key is read from the single request, is never
  written to project state or browser persistence, and is not included in
  response or audit data.
- Wallet keys, mnemonics, PEM, deploy signers and service/provider secrets are
  outside eligible project context and permission scopes.
- Audit output redacts secret-shaped fields and chains entries to expose local
  tampering.
- The optional Grok Build ACP process starts with no inherited environment and
  receives only explicitly allowlisted JSON-RPC methods.

## Command and deployment boundary

The Web product cannot execute arbitrary local commands. Desktop execution
exposes the exact command, working directory, environment class and risk,
accepts only bounded `test`, `check`, and single-package `install` tasks, and
runs without a shell. macOS test/check tasks deny network and all writes outside
the per-project workspace. Package installation uses the bundled npm CLI,
requires one package name plus an optional numeric version, disables lifecycle
scripts and global installation, and keeps its cache and `node_modules` inside
the user-local hashed project workspace. The workspace survives an application
restart. Test/check tasks also enable the bundled Node permission model, allow
filesystem access only to that workspace, and do not grant network, child
process, worker, native-addon, WASI, inspector, or FFI permissions. macOS adds
an outer operating-system sandbox; Windows uses the Node permission boundary.
Agent Git uses the owner-isolated repository broker for local init, exact-path
stage and commit only. The preview binds workspace revision, branch, HEAD,
commit message, file digests/byte counts and Tester event hash. Approval is
rejected if any binding changes. Hooks, signing, prompts, credentials and all
remote/network operations remain disabled. Revalidation, exact-path staging and
commit execute under one owner/project repository lock so another request
cannot widen the staged set between review and commit. Git push and deployment are not in
the executor allowlist.

YNX Developer never handles a private key. Deployment requires exact Wallet
authorization and a separate final network approval. A submitted hash remains
unconfirmed until an authoritative receipt succeeds; local source evidence does
not become remote public verification.

## Failure and recovery

Provider unavailable, 429, timeout, empty output, cancel and interruption remain
failures. No canned result is substituted. Runs retain the reviewed plan,
permission decisions, tool timeline, diff, test/build evidence, artifact hashes
and checkpoint so the user can resume, reject or revert. Revert is destructive,
confirmed and audited.
