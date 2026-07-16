# YNX Developer desktop boundaries

`scripts/package-local-macos.sh` builds a real macOS Testnet Preview `.app` and ZIP. The
Mach-O receives Apple's automatic linker ad-hoc signature, but has no signing
team identity, Developer ID or trusted distribution signature; this is the
project's **unsigned local package** class, not a signed release. It bundles the
Web Product, starts a loopback-only server, and adds a native
command bridge, native File/Edit/Window menus, project shortcuts, window-frame
restart restoration and a fail-closed update panel. The bridge accepts only `test` and `check`, copies the approved
project snapshot into an Application Support workspace, invokes Node without a
shell, denies network access through the macOS sandbox, bounds files and bytes,
streams real output, returns the real exit code, and supports cancellation.

This package is intentionally identified as
`com.ynxweb4.developer.testnetpreview` and its title contains `Testnet Preview
(unsigned)`. Local resource self-test and exact ZIP hashing are reproducible.
This host's execution policy refused cold-launching the ad-hoc-signed bundle, so
no installed cold-launch claim is made. It is not notarized, Developer ID
signed, installer-signed, independently audited, or a production desktop
release. The Windows WPF/WebView2 project under `desktop/windows` is complete
source with equivalent native menus, shortcuts, window persistence, least-
privilege manifest and update boundary, but was not built on this macOS host.
