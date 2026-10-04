# YNX Developer desktop boundaries

The current macOS application opens a producer-sealed Theia workbench through
`local-workbench.mjs`. This is the full Node-backed editor inside a native Cocoa
window: Explorer, file tabs, Monaco, the VS Code extension host, language tools,
Git, debugging and PTY are composed into the runtime. Their presence does not
prove every extension or workflow works. The local editor opens a real folder;
it does not copy that folder into a browser demonstration.

Each canonical project has its own private persistent profile and a lifetime
lock. The OS sandbox permits the selected project and its profile while denying
other project access and outbound network connections. Native File/Open Folder
opens another application window. Save and close use the workbench's normal
dirty-file handling; saved layout is preserved when a window closes during
startup. Recent-folder records are written only after a native folder selection
has produced a matching live backend and project-profile binding.

The default theme is YNX Klein, with a `#002FA7` accent and dark editor surfaces.
Existing user theme preferences remain authoritative. Source and current
package evidence are recorded in
`../docs/integration/LOCAL_DESKTOP_KLEIN_CHECKPOINT_20261005.json`. This particular
arm64 package bundles Node 26.7.0 and requires macOS 27.0; it cannot be advertised
as compatible with earlier macOS versions. It is ad-hoc signed, with no
Developer ID, signing team or notarization, and has not been publicly released.

`scripts/package-local-macos.sh` produces the native package from clean source,
the sealed composed-core input and retained portable runtime inputs. It records
source, core, executable-file ledgers, SBOM and artifact hashes. The local
OS-user project identity does not grant a canonical Wallet or private-service
session. Actual online AI, Chain operations and formal normal-entry release
acceptance remain separate requirements.

The package identifier remains `com.ynxweb4.developer.testnetpreview`; About and
build metadata retain the unsigned Testnet Preview classification. The local
window title identifies YNX Developer and the open folder.
`scripts/verify-local-macos-package.sh` extracts the ZIP to a new temporary
directory, verifies its ad-hoc classification and bundled runtime, cold-launches
the real App, observes the packaged local server and verifies cleanup after App
termination. This is local unsigned Testnet Preview evidence; it is not
notarized, Developer ID signed, installer-signed, independently audited, or a
production desktop release. The retained legacy Web Product mode still has its
restricted native `test`/`check` snapshot bridge; the full local workbench does
not use that bridge.

The Windows WPF/WebView2 entry under `desktop/windows` currently opens the hosted
projects page. Its native menus and profile source do not prove a local Windows
editor. No sealed Windows core/Node distribution has been verified, and the C#
host has not been compiled or launched on this macOS machine. Linux server
artifacts likewise do not establish a native Linux desktop release.
