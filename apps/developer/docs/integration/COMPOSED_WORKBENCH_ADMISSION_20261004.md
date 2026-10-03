# Composed workbench: normal-entry consumer contract

The normal YNX `/projects` UI, current identity consumer, durable session/writer
journal, `/sso/core-open` entry and HTTP/WebSocket proxy remain the product path.
The new runtime uses this same path. A installs its execution driver and protected
operator adapter; the IDE owner does not create another Host, account system,
authentication shortcut or raw loopback launch link.

The source checkpoint preceding integration is
`98a1253e5e34a0cf88337b73d8fd67755f693d6e`, tree
`6bf2cb73ae307d9a690348e6c8e7a86decb5fc7e`, branch
`codex/ide-quota-command-diagnostics-20261002`, worktree
`/Users/huangjiahao/.codex/worktrees/ide-quota-command-diagnostics/YNX Chain`.
All implementation and candidate paths belong to `apps/developer`.

## Operator artifact and driver

`runtime/theia/scripts/package-runtime.mjs` creates a new immutable candidate
directory and a separate adjacent `.pin.json`, retaining generated runtime,
upstream extension payloads, inherited YNX Tools and component notices. The
manifest has its own tree/lock/architecture identity. It is not an upstream
OpenVSCode archive and must not be labelled with that archive's digest.

Use `verifyComposedRuntime(artifactRoot, reviewedPin)` from
`services/codeoss-service/src/composed-runtime.mjs` before admitting execution.
A protects the installed artifact, pin, executable and all parent directories
against workspace/Gateway modification and verifies them again at execution.
The pure verifier checks bytes/tree identity; it does not establish root
ownership, hard quota, network policy, process isolation or runtime absence.
The build's available notices and declared licenses need release review.

The protected `/etc/ynx-developer/adapters/*.mjs` module returns:

```js
createDeveloperCoreAdmission({
  executionDomain: admittedIndependentDomain,
  architecture: reviewedPin.architecture,
  runtimeArtifact: reviewedPin,
  driver: admittedDriver
});
```

`admittedDriver.runtimeArtifact` must exactly match the protected reviewed pin.
The source wrapper checks the durable `context.image` against that pin before
start/connect/stop/inspect/prepare. Wrong-family or changed-artifact recovery
retains the writer and refuses execution. A retains the appropriate old driver
for existing legacy sessions; switching the current factory does not retire an
old runtime or prove it stopped. Each new composed session's artifact identity
is saved transactionally in the existing SQLite journal. Cold recovery reads
that saved identity rather than the newly configured pin.

The driver still supplies `start`, `stop`, `connect`, optional `inspect`,
`prepareProjectDirectory` and exact protected `projectsRoot`. All owner/project,
runtime/session UUID and identity-digest checks remain. Start must confirm the
same runtime; Stop must confirm that runtime, identity and zero descendants
before checkpoint/writer release, including lost-start/transport recovery.
Connect returns only a private OS-contained listener socket with existing
`private-loopback-without-connection-token` mode, never a published user port.

## Execution inputs and browser integration

Execute the admitted platform's Node with the reviewed
`lib/backend/main.js`, the owned persistent `projectDirectory/workspace`, a
private loopback listener and the admitted plugin root. Provide only explicit
development environment values:

- `THEIA_APP_PROJECT_PATH`: protected composed artifact root.
- `THEIA_CONFIG_DIR`: persistent project/owner-specific profile, never another
  user's profile or a shared writable executable/configuration root.
- `THEIA_DEFAULT_PLUGINS` / `--plugins local-dir:...`: reviewed built-ins plus
  that owner's installed extension storage under admitted isolation.
- `YNX_CORE_SESSION_ID`: exact opaque durable broker session UUID.
- `YNX_CORE_WORKSPACE`: this session's exact owned `projectDirectory/workspace`.
- Optional `YNX_IDE_DAP_ENTRY` / `YNX_IDE_DAP_PORT`: reviewed debugger entry and
  exact contained loopback port; no workspace-selected executable.

The YNX session locator is not authorization. YNX Tools opens the existing
parent-product review page; canonical session, Wallet review, AI proposal and
revoke/cancel checks remain there. Private keys, proofs, refresh handles and
provider keys never enter the workbench, extension, terminal or debugger.

The candidate builder installs the exact reviewed composed activity helper
before workbench scripts. The existing proxy supplies a per-document nonce and
private activity capability. It accepts both the retained legacy helper and
the reviewed composed helper; Theia webview bootstrap documents receive opaque
sandboxing and cannot register a root service worker. A still needs an admitted
webview/resource origin and the corresponding complete extension lifecycle
verification. The initial workbench CSP keeps executable resources on its own
origin; do not add wildcard framing/connect exceptions to make an extension
appear to work.

## Verified scope and remaining integration

The current standalone macOS arm64 candidate runs independently of the source
checkout and passes 12 actual journeys: the nine real editor/language/PTY/debug
journeys, official Git/Git-base staging through the command palette followed by
actual PTY Git commit/readback, inherited YNX Klein Light theme colors, and
inherited YNX Tools activation with unbound-project refusal and preserved files.
This establishes real extension integration, not a Wallet login or
successful Chain deployment. The relevant normal-entry/artifact/recovery/proxy
contract suite passes 36 tests. These tests are controlled source tests.

The broad broker suite retains one missing-input failure:
`central-family.test.mjs` requires `YNX_QA_CENTRAL_SOURCE`; no Central checkout
or real account was substituted. Host/public/full-device acceptance remains
unverified. This macOS build is not a Linux executable or a production capacity
result. A needs its own Linux native build/pin, protected runtime driver,
hard project/owner quota and resource admission, approved existing network path,
canonical parent session integration, profile/extension persistence, installed
platform tests and formal release. Preserve specifically rejected LXD/egress
operations, prior artifacts, profiles and recovery data.

The tested candidate is
`apps/developer/.ynx-developer-candidates/ynx-composed-workbench-git-brand-20261004-mac-arm64`:

| Pin | Exact value |
| --- | --- |
| architecture | `darwin-arm64` |
| manifest SHA256 | `db911f9674d8f816ad425b91c3aad026fc523c13b595771832df1821c2ea0c54` |
| tree SHA256 | `7f3855b71ec4173f952a5141e078a12440986f80c700c65d31aa618d1ce85f73` |
| lock SHA256 | `58cc71339e2083b56ffef3b367528b6bb5717fba551571bc86d94234acd991e7` |

Actual runtime receipt is
`/private/tmp/ynx-theia-extension-qa-tb4QfO/actual-host-browser.json` and log
`/private/tmp/ynx-ide-composed-git-ready-browser.log`. The screenshot and receipt
are frozen separately in the owned candidate evidence directory. The old
missing-Git-base, UI readiness and notification-selector failures are preserved.
