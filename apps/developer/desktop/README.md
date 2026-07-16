# YNX Developer desktop boundaries

`scripts/package-local-macos.sh` builds a real macOS Testnet Preview `.app` and ZIP. The
Mach-O receives Apple's automatic linker ad-hoc signature, but has no signing
team identity, Developer ID or trusted distribution signature; this is the
project's **unsigned local package** class, not a signed release. It bundles the
Web Product and a portable arm64 Node runtime, starts a loopback-only server, and
adds a native command bridge, native App/File/Window menus, project shortcuts,
window-frame restart restoration and a fail-closed update panel. The bridge accepts only `test` and `check`, copies the approved
project snapshot into an Application Support workspace, invokes Node without a
shell, denies network access through the macOS sandbox, bounds files and bytes,
streams real output, returns the real exit code, and supports cancellation.

This package is intentionally identified as
`com.ynxweb4.developer.testnetpreview` and its title contains `Testnet Preview
(unsigned)`. Each build emits an exact ZIP SHA-256 for that artifact; changing
build inputs or archive metadata can change the hash.
`scripts/verify-local-macos-package.sh` extracts the ZIP to a new temporary
directory, verifies its ad-hoc classification and bundled runtime, cold-launches
the real App, observes the packaged local server and verifies cleanup after App
termination. This is local unsigned Testnet Preview evidence; it is not
notarized, Developer ID signed, installer-signed, independently audited, or a
production desktop release. The Windows WPF/WebView2 project under
`desktop/windows` is source with native menus, shortcuts, window persistence,
least-privilege manifest, bundled-runtime contract and update boundary. Its
structural source check passes, but it was not compiled or launched on this macOS
host.
