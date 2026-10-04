# Composed workbench: normal-entry consumer contract

Latest owned runtime checkpoint: workbench **0.3.3**, candidate
`ynx-composed-cold-recovery-20261004-mac-arm64`; exact pin and 32 actual current
browser checks plus eight filesystem/native tests are in
`COMPOSED_COLD_RECOVERY_20261004.json`. Lock
`97eb5d1c1772ebda1dc3ffc897643b75313966a6aa4779973495b71e9d8fcc10`, tree
`7845ceba0aabafae7a523ed468bf05a33ffbdf28a36d203d5dbe5348b9dcc8e2`, manifest
`4f896c9d0531d4473697407f8a7bef416c877cd75094496637289bc16c0d8643`.
The prior 0.3.1 language/core 25 checks remain separate historical acceptance.
The five nonsecret bindings, persistent sibling profile and protected parent
contract below are unchanged. A must select the exact reviewed new artifact in
its registered driver; historical pins and recovery families remain available.
This checkpoint does not admit a public or canonical session or replace A's
execution-domain, quota and identity checks.

The same-runtime RPC `/services/ynx-draft-recovery` exposes only `list`,
`getBaseline`, `upsert`, `remove`. It consumes the existing canonical workspace
and persistent sibling profile, creates no credentials and grants no session.
Backups stay inside `profile/ynx-draft-recovery-v1`; archives are mode 0600,
directory 0700, two alternating atomic fsynced snapshots. Each draft is bounded
to 2 MiB, with at most 64 entries and a 16 MiB serialized snapshot. Pending or
damaged snapshots are retained and recovered read-only. Existing changed files
receive recovered untitled copies, rather than replacement writes. Checkpoint
debounce is 200 ms plus async persistence: the latest keystrokes before abrupt
termination are not guaranteed. A retains disk quota and exclusive writer
ownership around this service; the archive bound does not replace hard quota.

The existing macOS packager can include an exact verified `workbench.tar`, pin
and distribution receipt through `YNX_DEVELOPER_COMPOSED_ARTIFACT` and
`YNX_DEVELOPER_COMPOSED_PIN`. The archive keeps native bytes unchanged across
outer app signing. Protected installation must extract with preserved modes
(`tar -xpf`), verify the exact pin and supply compatible Node v26.7.0 via the
registered driver. The shell's bundled Node is independent and is not asserted
to execute this core. No workspace-selected extraction or automatic admission
is added; canonical parent absence still refuses normal execution.

The complete local macOS App/DMG containing this archive is now built at
`.ynx-developer-candidates/ynx-composed-cold-native-package-20261004-mac-arm64`.
It embeds source commit `d34130186520b9e860638888554ee433619ec634`, tree
`ac33c267ff2f7090255216f17a9d2d0bb4586925`; DMG SHA256
`63905cd0516e8a5a9cec6dfecf875a404ca250a9518528cd0b0882ff7da30fe8`.
Deep strict ad-hoc signature verification, disk-image verification and unchanged
core archive after outer sealing pass. It was not installed or launched and
does not establish normal canonical admission, Developer ID/notarization or
formal native product acceptance. This documentation continuation does not
relabel the package's embedded source commit.

The normal YNX `/projects` UI, current identity consumer, durable session/writer
journal, `/sso/core-open` entry and HTTP/WebSocket proxy remain the product path.
The new runtime uses this same path. A installs its execution driver and protected
operator adapter; the IDE owner does not create another Host, account system,
authentication shortcut or raw loopback launch link.

The semantic source checkpoint preceding this continuation is
`c5aaae9499b1770d4f4c41a0ce05b30a0eda8d0f`, tree
`f6f81f7a928f1dc00cd1256a83ccecc1014d0bbf`, branch
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

For new composed sessions, the registered driver can consume the owned helper:

```js
const bindings = composedWorkbenchBindings(context, {
  artifactRoot: protectedArtifactRoot,
  runtimeArtifact: reviewedPin
});
// A verifies/creates these protected, per-project directories under its quota
// and launches only its registered executable with explicit development env.
// The helper returns locators; it performs no authentication or execution.
```

`services/codeoss-service/src/workbench-bindings.mjs` verifies the same context
and durable artifact, derives `workspace` and sibling `profile` from the
already admitted persistent `projectDirectory`, and produces five explicit
non-secret environment values. Reopening preserves the profile directory while
changing the Tools session locator. Other projects get different profiles.
Its three tests and the five admission tests pass; these are controlled binding
tests, not real canonical admission. Legacy recovery retains its old driver and
profile mapping. An established legacy profile is not silently moved or reset.

## Execution inputs and browser integration

Execute the admitted platform's Node with the reviewed
`lib/backend/main.js`, the owned persistent `projectDirectory/workspace`, a
private loopback listener and the admitted plugin root. Provide only explicit
development environment values:

- `THEIA_APP_PROJECT_PATH`: protected composed artifact root.
- Use the manifest's reviewed Node version/options, including disabling its
  browser navigator global for the real Node language extension host.
- `THEIA_CONFIG_DIR`: persistent project/owner-specific profile, never another
  user's profile or a shared writable executable/configuration root. New
  composed profiles use `context.projectDirectory/profile`.
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

This consumer is already composed in the normal Gateway: `server.mjs` loads
the protected admission adapter, supplies its driver to the durable broker,
and passes that broker to `createNativeToolsService`. The extension's
`ynx.openTools` opens `/native-tools?sessionId=...`; its requests go to
`/runtime/native-tools/*`. Every request calls `coreService.authorizeConnection`
and delegates to existing Chain, Wallet readiness or the model router, with
one-use review and identity rechecks. Do not substitute a fixture identity,
new model provider, direct RPC credential or extension-authorized request.

The single remaining A integration input is an **actual registered composed
driver session** reachable through `/projects` and `/sso/core-open`, with the
two exact `YNX_CORE_*` values propagated to the Node plugin host and its
canonical parent-product admission available at `/native-tools`. The IDE owner
can then exercise the real Chain readback, Wallet review and AI review/apply
consumer. A supplies no keys through the runtime. Merely supplying a locator
or opening the page is not authentication or completed consumer acceptance.

The candidate builder installs the exact reviewed composed activity helper
before workbench scripts. The existing proxy supplies a per-document nonce and
private activity capability. It accepts both the retained legacy helper and
the reviewed composed helper; Theia webview bootstrap documents receive opaque
sandboxing and cannot register a root service worker. A still needs an admitted
webview/resource origin and the corresponding complete extension lifecycle
verification. The initial workbench CSP keeps executable resources on its own
origin; do not add wildcard framing/connect exceptions to make an extension
appear to work.

The profile must persist `settings.json`, `backend-settings.json` (including
`installedPlugins.disabledPlugins`), installed/deployed extension directories,
workspace storage and extension global storage under the same admitted project
quota. Keep temporary caches/log retention bounded through the registered
driver; neither a browser reload nor a two-runtime check proves hard capacity.

## Verified scope and remaining integration

The current standalone macOS arm64 candidate runs independently of the source
checkout and passes 16 actual journeys, including unopened-import semantic
completion, definition/rename/format/diagnostic, dirty-close preservation and
Unicode arbitrary-suffix files, official Git/Git-base staging followed by
actual PTY Git commit/readback, inherited YNX Klein Light theme colors, and
inherited YNX Tools activation with unbound-project refusal and preserved files.
Workbench 0.2.9 repeats all 16 without page errors and adds three complete
settings/reload, Explorer/search and extension disable/reload/enable journeys.
The normal-entry frontend has also been built with its server-reported
kernel/license display; this build alone does not prove public admission.
This establishes real extension integration, not a Wallet login or
successful Chain deployment. The relevant normal-entry/artifact/recovery/proxy
contract suite passes 36 tests. These tests are controlled source tests.
The new binding helper plus admission suite passes eight tests. A separate
earlier-candidate check ran two real contained backends with distinct rendered
preferences and actual PTY refusal of the other running profile/project. This
is two synthetic sessions; hard quota, exhaustion and canonical multi-user
authorization remain unverified. See `COMPOSED_WORKBENCH_PRODUCT_PATHS_20261004.json`
for separate current/prior artifact and runner identities.

The broad broker suite retains one missing-input failure:
`central-family.test.mjs` requires `YNX_QA_CENTRAL_SOURCE`; no Central checkout
or real account was substituted. Host/public/full-device acceptance remains
unverified. This macOS build is not a Linux executable or a production capacity
result. A needs its own Linux native build/pin, protected runtime driver,
hard project/owner quota and resource admission, approved existing network path,
canonical parent session integration, profile/extension persistence, installed
platform tests and formal release. Preserve specifically rejected LXD/egress
operations, prior artifacts, profiles and recovery data.

The tested current candidate is
`apps/developer/.ynx-developer-candidates/ynx-composed-profile-lifecycle-20261004-mac-arm64`:

| Pin | Exact value |
| --- | --- |
| architecture | `darwin-arm64` |
| manifest SHA256 | `69c3c54b5846056bfb54045f4911e06519391a5e7c4ec03f25b474d52ce617e6` |
| tree SHA256 | `d5578c166418e7ff698c71a5957356fee3b77875ddf103e48ba0e84fb84df06c` |
| lock SHA256 | `995b12f2eb03e341e72e3603ef9774553fd2406f188d66d7b9c160c9e7a806ff` |

Actual runtime receipt is
`/private/tmp/ynx-theia-extension-qa-nxS7rZ/actual-host-browser.json` and log
`/private/tmp/ynx-ide-profile-lifecycle-semantic-regression.log`. The same QA has
the separate `product-lifecycle-browser.json`. The screenshot and receipt
are frozen separately in the owned candidate evidence directory. The old
missing-Git-base, UI readiness and notification-selector failures are preserved.
The earlier 12-path candidate remains intact; its word-only completion assertion
was not conclusive semantic evidence. Cold first-file language activation is
asynchronous; the stronger test re-requests real completion within 30 seconds.
