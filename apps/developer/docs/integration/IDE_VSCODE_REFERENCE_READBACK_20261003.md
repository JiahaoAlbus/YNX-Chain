# VS Code reference and implementation readback

The human explicitly authorized both official online documentation and their installed VS Code as references. This records observed behavior and the existing source integration; it is not full-workbench acceptance.

## Actual desktop reference

Opened `/Applications/Visual Studio Code.app` through computer-use control. The initial window had no folder or editors open. Did not open or execute an existing user project, change global settings, install extensions, or update the user's pending extensions.

Observed Explorer, Search, Source Control, Run and Debug, Extensions, primary/secondary sidebar and panel controls, menu bar, status bar and editor split controls. Command-N created an untitled editor and Command-Shift-P opened the searchable command palette. Selected JavaScript using the status-bar language picker. Pasted only synthetic text:

```js
const wallet = { address: "ynx-test", balance: 42 };
wallet.
```

Running the native `Trigger Suggest` command showed `address` with `(property) address: string`, `balance`, and `wallet` in the suggestion widget. The installed user's inline completion provider also displayed a separate ghost-text proposal; that is not a YNX AI integration or proof. The subsequent screenshot/pairing step was stopped by a locked Mac. Pairing, save/reopen, folder opening and closing this synthetic unsaved editor remain NOT_VERIFIED in this reference run. Leave that editor's contents recoverable rather than closing another person's dirty file.

## Official behavior references

- [Basic editing](https://code.visualstudio.com/docs/editing/codebasics): normal editing, opening/saving, selection and navigation behavior.
- [IntelliSense](https://code.visualstudio.com/docs/editing/intellisense): language-service semantic completion, parameter/quick information, member lists, trigger characters and manual suggestion commands. Word suggestions and AI inline suggestions are separate capabilities.
- [Workspaces](https://code.visualstudio.com/docs/editing/workspaces/workspaces): folder/multi-root workspace state, folder settings, task/debug configuration and restored editor layout.
- [Terminal basics](https://code.visualstudio.com/docs/terminal/basics): native integrated shell and terminal controls.
- [Extension capabilities](https://code.visualstudio.com/api/extension-capabilities/overview): themes, commands and contributed views provide the YNX additions around the retained upstream workbench.

These official pages were fetched on 2026-10-03. The old `/docs/getstarted/userinterface` fetch failed twice; no content from that failed request is claimed.

## Concrete integration in the inherited source

| User requirement | Existing implementation surface | Remaining actual gate |
| --- | --- | --- |
| Complete familiar editor/workbench | Pinned OpenVSCode distribution; `scripts/package-native-core.mjs` derives new verified branded bytes while retaining upstream workbench | Approved exact core archive and actual admitted runtime, then the complete normal-use journey |
| Own YNX appearance | `native/ynx-brand/klein-light.json`, `workbench-brand.css`, verified original logo; `runtime-files.mjs` installs the brand extension in the isolated project's extension directory | Render and inspect in that actual upstream workbench at ordinary window sizes |
| Chain/Wallet/AI additions | `native/ynx-tools/package.json` contributes the YNX activity-bar view and commands; `extension.cjs` opens the session-bound tools page and preserves reviewed context/diff operations | Real canonical Wallet operation and real approved AI response, apply/save/reopen in the same project |
| Normal project launch | `/projects` renders `NativeIDEHome`; `NativeIDEPanel` uses the existing session catalog, one-use launch, identity retirement and upstream navigation | The Mac currently starts its guest editor and links externally to hosted Wallet projects. It still needs the admitted primary full-workbench entry and correct native file-menu routing |
| Files and recovery | Upstream filesystem/editor behavior remains the primary requirement; source `33000d7c5` repairs bounded text-file opening in the retained guest recovery editor | Guest picker GUI test and full upstream arbitrary text/binary/Unicode files are separate gates |

Do not rebuild Explorer, tabs, command palette, terminal, debugger, Git or IntelliSense as another Monaco imitation. Keep those upstream components and add YNX through its extension/theme/brand surfaces. The exact missing approved shared runtime bundle and same-workbench acceptance steps are in `IDE_VSCODE_PARITY_EXECUTION_20261003.md`.

## Current compatibility artifact

The source `33000d7c5348444d3f2f0bcb8a21231ff73b6ecf`, tree `2abf508eedb457f7fe74f6d042083c769c3b8091`, produced the unsigned Mac preview DMG SHA-256 `e94f90d40df38ff36ea92a71969af7d4b1abffc0637772ef98e3a955c82edfaf`. Its mounted installed-copy verifier passed provenance/signature, macOS target, real bounded C++ compile/LSP, isolated language-service requests, persistent second launch and child cleanup. Log: `/private/tmp/ynx-ide-330-installed-20261003.log`.

It is an ad-hoc signed compatibility preview, not the complete admitted upstream workbench or formal release. Its new Open Files GUI was not validated by those service checks.

## Primary-entry refactor after the reference run

The primary `/projects` and tools entry no longer eagerly imports the guest Workbench. `GuestWorkspace.tsx` keeps the existing recovery gate and editor together in an on-demand chunk. The production browser test verifies no GuestWorkspace chunk request at project-home startup, then verifies it is requested when the existing desktop state handshake enters recovery. The not-ready host bridge remains during loading and does not replace an already installed bridge.

Actual controlled production-build checks passed all nine desktop-entry journeys, including original file bytes, explicit save/reload, damaged-profile preservation and wrong-origin/frame denial; the actual workspace-module recovery tests passed 9/9. The old data-URL recovery harness could not resolve its newly inherited relative identity import; it now imports the actual TS module through the same extension-resolution hook as the Open Files tests. Browser readiness polling now awaits each host reply outside the browser wait predicate, and requires both workspace and editor readiness. Initial failing runs are visible in the tool transcript.

Build log: `/private/tmp/ynx-ide-native-entry-split-build-20261003.log`. Browser receipt: `/private/tmp/ynx-ide-native-entry-split-browser-20261003.json`. Recovery log: `/private/tmp/ynx-ide-native-entry-split-recovery-20261003.log`. This separates the retained compatibility editor from the native project entry; it does not supply the missing admitted upstream runtime, change the Mac's guest-first startup, or prove public Wallet/AI acceptance. The earlier source/archive/DMG identities remain frozen and do not include this later refactor.
