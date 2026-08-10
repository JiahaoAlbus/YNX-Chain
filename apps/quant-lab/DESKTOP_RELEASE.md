# Desktop release status

## macOS

The arm64 `.app` candidate contains the desktop supervisor, Quant API daemon,
web daemon, and versioned web assets. It stores state in the user's application
configuration directory, binds only loopback ports, waits for health before
opening the browser surface, and terminates child services with the supervisor.

Direct evidence: cross-build passed; ad-hoc deep signing and strict verification
passed; a fresh Applications-layout extraction cold-launched the Quant supervisor,
API and web service; `/version`, `/health`, `/metrics` and frontend HTML were
verified; live funds remained disabled; shutdown released the child-service ports.
Signing class is `adhoc-test-only`. Apple Developer ID, notarization,
hardened-runtime entitlement review, immutable hosting, and store release are
false.

The reproducible local macOS archive built twice from source commit
`909031e510272e9f92a11d9e9dc8553a1934692f` is 7,378,056 bytes with SHA-256
`5edff1d728ef8430b2a8ea983696e7ce756cb46f20593e56eae7e98ce415c395`.
The fresh cold start returned this exact commit from `/version`, a ready health
response with live funds disabled, Prometheus build/risk signals and the YNX
Quant Lab frontend title. The machine-readable record is
`apps/quant-lab/evidence/local-macos-desktop-cold-start-20260810.json`.

## Windows

The x64 candidate contains the same supervisor/API/web/assets layout and was
cross-compiled into an archive. It is `unsigned-cross-compiled`. There is no
Windows host launch, installation, antivirus/SmartScreen, minimum-version, or
uninstall evidence, so `installedLocal` applies only to macOS.

The reproducible local Windows archive built twice from the same source commit is
8,094,216 bytes with SHA-256
`491816aa6101fa544af4f2da4459b364bb71245a82a0a06ad889c206a1ae90e7`.

The 2026-08-10 refresh used Go 1.25.7 on Darwin arm64. The hashes changed
from the earlier local evidence while the source inputs and archive byte counts
remained unchanged, so the release record now binds the build toolchain as well
as the source commit. Both archives reproduced byte-for-byte across two fresh
builds in the recorded environment.

Desktop currently opens the product in the user's default browser while owning
the local service lifecycle; it is not represented as an embedded native WebView.
