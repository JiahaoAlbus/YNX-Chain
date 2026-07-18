# YNX AI Build security model

YNX AI Build is a permissioned engineering workflow, not an autonomous release
principal. Its state machine is implemented in `packages/developer-client` and
keeps the provider adapter below the product permission layer.

## Workflow and approvals

The persisted lifecycle covers intent, plan, plan review, explore, context
selection, edit, diff review, test, build, fix, package, deploy review,
checkpoint, revert and audit. A run can pause, resume, cancel, fail and recover.
Writes require an approved plan, approved paths, a reviewed diff and one-time
write permission. Test/build execution, network, package install,
secret-reference, Git commit, Git push and deployment are separate permissions.
One-time grants cannot be reused.

## Data boundary

- Only user-checked project paths can enter the provider request.
- Context, prompt and language are sent in a bounded POST body; never a URL.
- Provider tokens are session-only and are not persisted or exported.
- Wallet keys, mnemonics, PEM, deploy signers and service/provider secrets are
  outside eligible project context and permission scopes.
- Audit output redacts secret-shaped fields and chains entries to expose local
  tampering.
- The optional Grok Build ACP process starts with no inherited environment and
  receives only explicitly allowlisted JSON-RPC methods.

## Command and deployment boundary

The Web product cannot execute local shell commands. Desktop execution exposes
the exact command, working directory, environment class and risk, accepts only
the bounded `test` and `check` tasks, runs without a shell and denies network and
out-of-workspace writes in the macOS sandbox. Git push, package installation and
deploy are not in that executor allowlist.

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
