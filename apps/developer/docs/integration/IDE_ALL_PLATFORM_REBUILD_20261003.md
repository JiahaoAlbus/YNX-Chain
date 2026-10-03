# All-platform YNX IDE rebuild requirement

The human now explicitly requires rebuilding all YNX IDE platforms around the complete VS Code coding experience, with YNX appearance and Chain/Wallet/AI development advantages. This is the full product requirement, not a guest-editor compatibility target. Preserve inherited projects, extensions, user settings, identity integration and recovery data.

## Actual version gap

Read only public installed application metadata on 2026-10-03: `/Applications/Visual Studio Code.app/Contents/Resources/app/package.json` version **1.140.0**; `product.json` commit **07f806f999227108933c2e30515b26eecc1fda74**, stable, date `2026-09-30T10:38:38+02:00`. No user settings or extension credentials were read.

Existing YNX server core pin is **OpenVSCode 1.109.5**, commit **072586267e68ece9a47aa43f8c108e0dcbf44622** in `services/codeoss-service/src/upstream.mjs`. Installing that existing pin alone cannot prove parity with the actual current reference. Obtain the approved exact newer open-source core artifact/source and license/notices/version/hash inputs through A's existing build/release role; review and update derived-runtime entry/manifest checks together. Do not merely change a version label, substitute Microsoft's installed distribution, or restart rejected network/package-egress/LXD operations.

## Platform delivery and required extension hosts

| Surface | Required result | Current authoritative source | Remaining gate |
| --- | --- | --- | --- |
| macOS desktop | Full upstream desktop workbench and applicable local/web/remote extension hosts, native files, terminal, Git and debug; YNX theme and ecosystem additions | `desktop/macos` is a WebKit preview shell; the 33000 DMG is a compatibility preview | Full desktop core integration, actual native extension hosts, preserved profile migration, install/normal-use verification and formal signing |
| Windows desktop | Same complete workbench and extension mechanisms, file dialogs, shortcuts and native behavior | `desktop/windows` is an inherited WebView2 preview with host/profile protections | Complete core, actual Windows runtime/compiler/debug/extensions, preserved profile migration and formal installer verification |
| Linux desktop | Same upstream desktop coding workflow and extensions | Existing `package-linux-server.sh` packages the server, not a verified full Linux desktop application | Full desktop core/build/install evidence and normal user flow |
| Web | Full upstream browser workbench with web extension host and approved remote Node extension host, persistent isolated projects | Existing OpenVSCode broker/SSO/proxy and YNX project home/tools consumer | Actual approved execution origin/runtime/identity, compatible extensions and real terminal/debug/Git in the same project |
| iOS/Android entry | Same projects and mature core through an applicable mobile entry; usable layout, touch/keyboard, file recovery and Wallet continuity | No complete owned native mobile IDE engineering/build evidence has been established | Actual applicable mobile workbench entry and device acceptance; do not treat installed TestFlight/Xcode or a new wrapper as full IDE proof |

Reference: [official extension hosts](https://code.visualstudio.com/api/advanced-topics/extension-host). Desktop local Node, web worker and remote Node hosts have different capabilities. A remote Linux workspace cannot prove execution of a desktop UI/device extension or another platform's native extension binary. Preserve the complete upstream mechanism instead of replacing it with a fixed YNX extension allowlist or fake plugin tiles.

## Coding and extension acceptance

Retain upstream Explorer, arbitrary files/folders and Unicode/binary handling, multitab/preview/pinning/split, dirty-close/cancel/save/reopen, search/replace, command palette and shortcuts, settings, themes, language switching, automatic pairs/skip/indent, semantic IntelliSense, signatures/hover/snippets/diagnostics, definitions/references/rename/format, native terminals, tasks, actual compiler/debugger, Git and applicable notebooks/custom editors.

Use the actual extension-management UI and verify discovery, details, install and VSIX, enable/disable, restart/reload, version update, uninstall and persistence per owner/project/platform. Verify actual activation and functionality of language tooling, debugger, formatter/linter, Git integration, themes/icons and representative custom views. Record installed package/version, API requirement, selected host, OS/architecture and actual failure reason. Extension marketplace access, publisher restrictions, proposed APIs and host requirements must be resolved individually; no universal compatibility claim is proved by an API name or successful installation alone. The existing server source points to Open VSX; that is not evidence that every extension from Microsoft's marketplace is available or runnable.

## YNX development additions

Use upstream extension/theme contribution surfaces for the YNX brand and ecosystem. Build on `native/ynx-brand`, `native/ynx-tools` and the existing canonical session consumer. The desired normal developer journey includes project templates and SDKs, Chain/network status, contract compile/test/debug, deployment and interaction with actual Wallet authorization and chain readback, and approved YNX AI context, code explanation/generation, reviewed changes, apply/save/reopen. The current read-only starter does not satisfy contract deployment or a complete development kit. Keep reviewed signing boundaries and existing stale/cancel/revoke protection while making these actions usable inside the workbench.

All platform and extension gates above remain NOT_VERIFIED as complete. The first committed structural refactor `9caac37d5` separates the guest editor into an on-demand recovery module and verifies that the project home does not load it. It does not supply a desktop core, upgrade the pinned server, or complete this all-platform requirement. A's exact admitted runtime bundle is still required for the inherited full-server route; a newly compatible desktop core requires its own exact source/artifact/build identity rather than an invented approved runtime.
