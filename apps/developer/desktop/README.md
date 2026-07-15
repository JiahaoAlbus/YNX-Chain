# YNX Developer desktop boundaries

`scripts/package-local-macos.sh` builds a real local macOS `.app` and ZIP. The
Mach-O receives Apple's automatic linker ad-hoc signature, but has no signing
team identity, Developer ID or trusted distribution signature; this is the
project's **unsigned local package** class, not a signed release. It bundles the
Web Product, starts a loopback-only server, and adds a native
command bridge. The bridge accepts only `test` and `check`, copies the approved
project snapshot into an Application Support workspace, invokes Node without a
shell, denies network access through the macOS sandbox, bounds files and bytes,
streams real output, returns the real exit code, and supports cancellation.

This package is intentionally identified as `com.ynxweb4.developer.local` and
its title contains `unsigned package`. It is not notarized, Developer ID signed,
installer-signed, Windows-built, independently audited, or a production desktop
release. No such claim is valid until exact platform signing, install, cold
launch and update evidence exists.
