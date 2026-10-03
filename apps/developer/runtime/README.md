# YNX Developer extensible workbench

This owned runtime composes Eclipse Theia 1.76.0, Monaco, a real VS Code
extension host, PTY, language tooling and DAP. The product requirement is
VS Code's coding workflows and interaction quality with YNX appearance and
Chain/Wallet/AI tools. A complete Code OSS fork is optional.

`theia/package-lock.json` pins the runtime dependencies. `ynx-workbench` is
the YNX frontend/backend contribution: inherited logo, product name, editor
close shortcut and an unprivileged macOS descendant-process cleanup helper.
The browser target has a real Node backend; it is not a standalone frontend.
Official framework documentation:
[composition](https://theia-ide.org/docs/composing_applications/) and
[VS Code extensions](https://theia-ide.org/docs/authoring_vscode_extensions/).
Extension API coverage and platform binaries must be checked per extension.

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

The test verifies extension-provided IntelliSense, pairs/selection wrapping,
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
candidate passes 12 real runtime journeys, including actual Git extension
staging and PTY commit/readback, inherited YNX theme colors and YNX Tools
activation with unbound-session refusal. Source contract tests pass 36 cases.
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

Next integration work uses the existing `native/ynx-tools` extension and
canonical product service consumer for Chain, Wallet and reviewed AI changes.
No provider key, Wallet proof or signing credential belongs in the extension
host, debugger, terminal or project files. Actual Chain compile/test/deploy,
Wallet authorization, AI review/apply, Git, extension-management lifecycle,
desktop installers, profile migration and mobile device journeys require their
own end-to-end verification. Do not restart a specifically rejected Host/LXD
or egress operation as a consequence of this runtime change.
