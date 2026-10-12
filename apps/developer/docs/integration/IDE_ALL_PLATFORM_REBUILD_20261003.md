# All-platform YNX IDE rebuild requirement

## Human clarification supersedes the core-source prerequisite

The human explicitly clarified that the requirement is VS Code's features, workflows and interaction quality, **not mandatory adoption of its complete open-source core**. Mainstream production components may be combined, and obtaining/setting up supporting development runtimes is authorized. Remove the missing full upstream archive as a prerequisite for owned workbench reconstruction. Compiler/toolchain, LSP, PTY, Git, DAP and extension execution are independently integrable. The installed VS Code version below is a behavioral/API reference, not a required product-version label.

Continue the inherited implementation and replace inadequate product surfaces while preserving files, profiles and canonical identity. Complete upstream workbench reuse remains an option. VS Code extension compatibility still requires an actual compatible extension host and verified package behavior; existing custom YNX extension records do not prove it. All full-feature/platform/Chain/AI acceptance requirements remain. Earlier statements below that require the full upstream desktop/core artifact describe the previous chosen implementation path, not a current human requirement or reason to stop. Shared Host/secrets/formal release retain their existing owner boundaries; do not infer permission to retry a specific previously rejected LXD operation from the general runtime authorization.

The newly authorized official npm fetch succeeded: `@theia/core`, `@theia/plugin-ext` and `@theia/plugin-ext-vscode`, all version 1.76.0, are retained in `.ynx-developer-candidates/theia-1.76.0-reviewed-components`. Every archive matches its reported SHA-512 integrity, with individual SHA-256 receipts. Scripts were disabled; no existing dependency lock, user profile or production runtime was replaced. These provide concrete source/library inputs for a mainstream extensible IDE approach, not proof of an installed extension host. The VS Code compatibility package has actual Theia frontend/backend DI modules and depends on the surrounding editor/filesystem/terminal/workspace/plugin services; it cannot be presented as a standalone drop-in adapter for the current React editor.

Owned UI reconstruction has resumed: `EditorTabs` now provides nonshrinking tabs, an independently accessible close button, arrow/Home/End navigation, middle-click close, and selected-tab visibility when switching or resizing. Closing selects the neighboring tab and retains file contents. The previous toolbar rule forced each action to 110px and starved the tab strip; it now uses content-sized actions. The actual production browser run passed the prior nine entry/recovery journeys plus overflow/resize/keyboard/close and real Monaco input followed by exported-content preservation. Build and browser receipts are `/private/tmp/ynx-ide-tab-rebuild-build-final.log` and `/private/tmp/ynx-ide-tab-rebuild-browser-input.json`. Earlier failing geometry/input runs remain separately logged. This proves the changed interaction surface, not full IDE/extension/Chain/AI completion.

The next owned interaction implementation adds actual `Ctrl/Command+P` Quick Open and a searchable `Ctrl/Command+Shift+P` Command Palette, following the official [VS Code interface workflow](https://code.visualstudio.com/docs/editing/getting-started/userinterface). File names/full paths accept contiguous or ordered abbreviation matches. Arrow keys change selection, Enter opens/runs the chosen result, and Escape preserves the active file. Closed files reopen with existing contents. The shared accessible picker uses the existing YNX theme and reports no matches without triggering any action. Command selection invokes actual workbench actions, including opening the file picker and toggling the real split editor. Production TypeScript/Vite build passed; the controlled production-browser suite now passes twelve journeys with no page errors, including both Ctrl and Command shortcuts. Receipts: `/private/tmp/ynx-ide-quick-picker-build.log` and `/private/tmp/ynx-ide-quick-picker-browser.json`. These are local frontend interaction results; installed desktop platforms, a full extension host, actual debug/Chain/AI journeys and public release remain separate acceptance work.

The human now explicitly requires rebuilding all YNX IDE platforms around the complete VS Code coding experience, with YNX appearance and Chain/Wallet/AI development advantages. This is the full product requirement, not a guest-editor compatibility target. Preserve inherited projects, extensions, user settings, identity integration and recovery data.

## Actual version gap

Read only public installed application metadata on 2026-10-03: `/Applications/Visual Studio Code.app/Contents/Resources/app/package.json` version **1.140.0**; `product.json` commit **07f806f999227108933c2e30515b26eecc1fda74**, stable, date `2026-09-30T10:38:38+02:00`. No user settings or extension credentials were read.

Existing YNX server core pin is **OpenVSCode 1.109.5**, commit **072586267e68ece9a47aa43f8c108e0dcbf44622** in `services/codeoss-service/src/upstream.mjs`. Installing that existing pin alone cannot prove parity with the actual current reference. This is the inherited server route, not a requirement to obtain a newer complete core before developing. The new composition has its own source/lock/native/extension artifact identity. Do not merely change a version label, substitute Microsoft's installed distribution, or restart rejected network/package-egress/LXD operations.

## Real composed runtime checkpoint, 2026-10-04

`runtime/theia` now runs an actual Theia 1.76.0 frontend/backend and VS Code
extension host, with the owned `runtime/ynx-workbench` contribution. Official
Open VSX JavaScript and TypeScript basics/language features 1.95.3 provide real
IntelliSense and input pairing. Official Microsoft JS debug 1.140.0 provides
actual Node breakpoint, variable and step behavior. The product header uses the
inherited YNX logo; Command+W closes the real editor tab.

The controlled macOS browser run passed **9 actual runtime journeys with 0 page
errors**, including saved disk readback, installed Node execution through the
PTY, breakpoint on line 2, real `marker` variable, F10 to line 3 while disk output
is still absent, then F5 and actual program output on disk. Another synthetic
project's read/write and outbound TCP are refused by OS permission errors.
The unprivileged descendant-process cleanup helper passed its actual process
test. No frontend, editor, language service, terminal or debugger is mocked.
Receipts: `/private/tmp/ynx-theia-extension-qa-WwlQss/actual-host-browser.json`,
`/private/tmp/ynx-ide-theia-debug-disk-ready-browser.log` and
`/private/tmp/ynx-ide-theia-process-helper-final.log`. Failed attempts remain
separate; the earlier breakpoint-on-empty-line and UI readiness/label assumptions
were corrected instead of accepting a successful program exit as debug proof.

This runtime is not yet the formal project-home entry, installed desktop/mobile
product, complete extension lifecycle or Chain/Wallet/AI journey. See
`runtime/README.md` for reproduction and the existing admission boundary.

## Platform delivery and required extension hosts

| Surface | Required result | Current authoritative source | Remaining gate |
| --- | --- | --- | --- |
| macOS desktop | Mature workbench and applicable local/web/remote extension hosts, native files, terminal, Git and debug; YNX UI and ecosystem additions | Existing WebKit shell plus real composed macOS QA runtime; the 33000 DMG predates this work | Production runtime integration, preserved profile migration, install/normal-use verification and formal signing |
| Windows desktop | Same coding workflow and extension mechanisms, file dialogs, shortcuts and native behavior | Inherited WebView2 preview with host/profile protections | Actual Windows runtime/compiler/debug/extensions, preserved profile migration and formal installer verification |
| Linux desktop | Same coding workflow and applicable extensions | Existing server package; composed runtime has not been verified on Linux desktop | Desktop build/install evidence and normal user flow |
| Web | Mature browser workbench with applicable extension hosts and persistent isolated projects | Existing broker/SSO/proxy and YNX tools consumer; composed runtime passes controlled macOS browser QA | Approved execution origin/runtime/identity, compatible extension lifecycle and Git in the same project |
| iOS/Android entry | Same projects through an applicable mobile entry; usable layout, touch/keyboard, file recovery and Wallet continuity | No complete owned native mobile IDE build evidence | Actual mobile workbench entry and device acceptance |

Reference: [official extension hosts](https://code.visualstudio.com/api/advanced-topics/extension-host). Desktop local Node, web worker and remote Node hosts have different capabilities. A remote Linux workspace cannot prove execution of a desktop UI/device extension or another platform's native extension binary. Integrate actual applicable extension mechanisms and verify behavior rather than using fake plugin tiles. The pinned QA set is a test input, not the product's complete extension catalog.

## Coding and extension acceptance

Retain upstream Explorer, arbitrary files/folders and Unicode/binary handling, multitab/preview/pinning/split, dirty-close/cancel/save/reopen, search/replace, command palette and shortcuts, settings, themes, language switching, automatic pairs/skip/indent, semantic IntelliSense, signatures/hover/snippets/diagnostics, definitions/references/rename/format, native terminals, tasks, actual compiler/debugger, Git and applicable notebooks/custom editors.

Use the actual extension-management UI and verify discovery, details, install and VSIX, enable/disable, restart/reload, version update, uninstall and persistence per owner/project/platform. Verify actual activation and functionality of language tooling, debugger, formatter/linter, Git integration, themes/icons and representative custom views. Record installed package/version, API requirement, selected host, OS/architecture and actual failure reason. Extension marketplace access, publisher restrictions, proposed APIs and host requirements must be resolved individually; no universal compatibility claim is proved by an API name or successful installation alone. The existing server source points to Open VSX; that is not evidence that every extension from Microsoft's marketplace is available or runnable.

## YNX development additions

Use upstream extension/theme contribution surfaces for the YNX brand and ecosystem. Build on `native/ynx-brand`, `native/ynx-tools` and the existing canonical session consumer. The desired normal developer journey includes project templates and SDKs, Chain/network status, contract compile/test/debug, deployment and interaction with actual Wallet authorization and chain readback, and approved YNX AI context, code explanation/generation, reviewed changes, apply/save/reopen. The current read-only starter does not satisfy contract deployment or a complete development kit. Keep reviewed signing boundaries and existing stale/cancel/revoke protection while making these actions usable inside the workbench.

All platform and extension gates above remain NOT_VERIFIED as complete. The first committed structural refactor `9caac37d5` separates the guest editor into an on-demand recovery module and verifies that the project home does not load it. It does not supply a desktop core, upgrade the pinned server, or complete this all-platform requirement. A's exact admitted runtime bundle is still required for the inherited full-server route; a newly compatible desktop core requires its own exact source/artifact/build identity rather than an invented approved runtime.
