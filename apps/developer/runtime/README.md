# YNX Developer extensible workbench

This owned runtime composes Eclipse Theia 1.76.0, Monaco, a real VS Code
extension host, PTY, language tooling and DAP. The product requirement is
VS Code's coding workflows and interaction quality with YNX appearance and
Chain/Wallet/AI tools. A complete Code OSS fork is optional.

`theia/package-lock.json` pins the runtime dependencies. `ynx-workbench` is
the YNX frontend/backend contribution: inherited logo, product name, editor
close/definition/rename shortcuts and an unprivileged macOS descendant-process
cleanup helper. Outline, call hierarchy and type hierarchy are explicitly
included in the composition; their presence is not full feature acceptance.
The browser target has a real Node backend; it is not a standalone frontend.
Official framework documentation:
[composition](https://theia-ide.org/docs/composing_applications/) and
[VS Code extensions](https://theia-ide.org/docs/authoring_vscode_extensions/).
Extension API coverage and platform binaries must be checked per extension.

Workbench 0.2.9 preserves the framework's view restoration while cancelling
deferred part sizing after a hidden container is disposed. This fixes the
actual extension-disable/reload error. Its adapted Theia code retains the
upstream notice in `ynx-workbench/NOTICE`, copied into packaged component notices.

The Node plugin host disables Node's browser `navigator` global and skips the
framework's compatibility getter through `PluginHostEnvironmentVariable`.
The getter returned `undefined` while still satisfying `'navigator' in globalThis`,
which caused the pinned TypeScript extension to select browser capabilities.
The candidate records the Node version/options used for its build and QA.
First-file extension activation remains asynchronous: the semantic test issues
real completion requests until imported properties appear within 30 seconds.
It does not count a word-only list as semantic IntelliSense or prove that the
first completion request during a cold startup is already ready.

## Reproduce the macOS controlled runtime

From `runtime/theia`, using an installed Node runtime and Command Line Tools:

```sh
npm ci --install-links --workspaces=false --ignore-scripts --no-audit --no-fund
node scripts/build-native-darwin.mjs /opt/homebrew/include/node
npm run build
node scripts/build-native-darwin.mjs /opt/homebrew/include/node
node --test scripts/process-helper.test.mjs
```

The first native build supplies `drivelist` for the framework bundler. The
second places the process helper beside the generated backend after bundling.
Use the installed Node's matching absolute header directory. Dependency
lifecycle scripts are disabled; native compilation uses existing tools directly.
Dependencies and generated bundles are ignored, while the lock and source are
tracked. After changing `ynx-workbench`, increment its version and reinstall
the local file dependency with `--install-links` before rebuilding.

Stage inputs into **new** absolute directories under
`apps/developer/.ynx-developer-candidates`:

```sh
node scripts/fetch-reference-extensions.mjs /absolute/new-extension-directory
node scripts/fetch-debug-adapter.mjs /absolute/new-debugger-directory
node scripts/start-isolated-qa.mjs /absolute/new-extension-directory /absolute/new-debugger-directory
```

The extension script pins official Open VSX JavaScript/TypeScript basics,
language service and Git/Git-base 1.95.3, and Microsoft's JS debug extension 1.140.0. It compares
the official archive SHA256, bounds extracted content and runs no install hooks.
The DAP script pins the official Microsoft standalone 1.140.0 release digest,
retains its archive and records per-file hashes. Licenses/notices remain in the
downloaded payloads; do not relabel them as YNX-authored components.

The launcher creates its own project, profile and short temporary directory.
It uses macOS OS sandbox enforcement, exact loopback ports and its own Unix
socket directory. It neither selects a real user profile nor authenticates a
Wallet. `runtime.json` identifies the actual listener and files. Run the real
browser journey against that receipt:

```sh
YNX_QA_PLAYWRIGHT_MODULE=/absolute/playwright/index.mjs node scripts/actual-host.browser.mjs /absolute/qa/runtime.json
```

The test requires properties from an unopened imported file, beyond words in
the active buffer. It also verifies definition navigation, symbol/reference
rename, formatting saved to disk, syntax diagnostics, dirty-close Cancel/Save,
nested Unicode filenames and arbitrary text suffixes, pairs/selection wrapping,
save/readback, visible YNX branding, close/reopen, real terminal execution and
OS-enforced cross-project/network denial. With the debugger it also verifies
an executable-line breakpoint, actual variables, stepping to the next source
line, and continued execution by reading target output from disk. No editor,
terminal or DAP response is mocked. Receipts and screenshots remain in the QA
directory, including separate failed attempts.

The standalone candidate builder also retains the existing YNX Tools and
YNX Klein Light theme extensions, component license declarations and available
legal notices, plus the reviewed activity bootstrap required by the normal
session proxy:

```sh
node scripts/package-runtime.mjs /absolute/new-runtime-candidate /absolute/staged-extension-directory
node scripts/start-isolated-qa.mjs /absolute/new-runtime-candidate/plugins /absolute/staged-debugger-directory /absolute/new-runtime-candidate
```

The adjacent `.pin.json` records manifest/tree/lock hashes and the actual native
architecture. Build each platform's native dependencies on that platform;
this macOS arm64 candidate is not a Linux artifact. The latest standalone
candidate passes 16 real runtime journeys, including unopened-file semantic
completion, rename/format/diagnostic and dirty-close preservation, actual Git extension
staging and PTY commit/readback, inherited YNX theme colors and YNX Tools
activation with unbound-session refusal. See
`docs/integration/COMPOSED_WORKBENCH_SEMANTIC_PATHS_20261004.json` for its exact
artifact pins and evidence. The earlier 12-path receipt is retained; its first
completion assertion alone did not exclude word fallback. The unchanged
normal-entry source contract has the earlier 36 passing cases.

The newer `ynx-composed-profile-lifecycle-20261004-mac-arm64` candidate passes
those 16 journeys again and three complete lifecycle journeys:

```sh
YNX_QA_PLAYWRIGHT_MODULE=/absolute/playwright/index.mjs node scripts/product-lifecycle.browser.mjs /absolute/qa/runtime.json
```

This exercises actual profile JSON editing, language-specific settings and
reload; Explorer folder/file creation and multi-file search; and YNX Tools
disable/reload/command removal followed by enable/reload/reactivation. It does
not contact a mocked registry or fabricate a Wallet session. A separate
`parallel-profile.browser.mjs <alpha/runtime.json> <beta/runtime.json>` check
keeps two real contained runtimes active, verifies different rendered profile
preferences and denies cross-profile reads/cross-project writes from the PTY.
Its retained receipt belongs to the preceding candidate and proves two synthetic
sessions, not canonical user authorization or production capacity.
`docs/integration/COMPOSED_WORKBENCH_PRODUCT_PATHS_20261004.json` records exact
current and prior evidence, including the normal-entry frontend build identity.
See `docs/integration/COMPOSED_WORKBENCH_ADMISSION_20261004.md` for the exact
normal-entry consumer contract and remaining A-owned integration.

## Integration boundary

This is an owned runtime component, not a completed all-platform product.
The existing project-home/session broker still uses its inherited admission
contract. Do not point its executable URL at a raw loopback listener or bypass
canonical owner/project/session checks. The new runtime needs its own immutable
artifact/tree identity and an admitted execution origin behind that contract.
Keep existing projects, recovery journals, settings and packaged candidates.
This macOS QA sandbox is not the public multi-owner admission provider.

`composedWorkbenchBindings` in `services/codeoss-service/src/workbench-bindings.mjs`
gives the registered driver exact non-secret project/workspace/profile and Tools
session bindings. The persistent profile stays beside the workspace on reopen;
the opaque session locator changes. The helper checks context/artifact identity
but neither authorizes a request nor creates a Host. Binding/admission tests
pass eight cases. Normal `/projects` About text now consumes actual catalog
kernel/license rather than hardcoding the legacy runtime.

Next integration work uses the existing `native/ynx-tools` extension and
canonical product service consumer for Chain, Wallet and reviewed AI changes.
No provider key, Wallet proof or signing credential belongs in the extension
host, debugger, terminal or project files. Actual Chain compile/test/deploy,
Wallet authorization, AI review/apply, Git, extension-management lifecycle,
desktop installers, profile migration and mobile device journeys require their
own end-to-end verification. Do not restart a specifically rejected Host/LXD
or egress operation as a consequence of this runtime change.
