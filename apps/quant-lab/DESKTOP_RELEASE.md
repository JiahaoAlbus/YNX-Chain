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
`8b211d08a67abc9e2b3d3f3254bbc87f4293b08e` is 7,377,983 bytes with SHA-256
`7df2bb3fd2f59ef3594a770004866feb8dff3495c3836bfeadec03d98dae2739`.
The fresh cold start returned this exact commit from `/version`, a ready health
response with live funds disabled, Prometheus build/risk signals and the YNX
Quant Lab frontend title. The machine-readable record is
`apps/quant-lab/evidence/local-macos-desktop-cold-start-20260729.json`.

## Windows

The x64 candidate contains the same supervisor/API/web/assets layout and was
cross-compiled into an archive. It is `unsigned-cross-compiled`. There is no
Windows host launch, installation, antivirus/SmartScreen, minimum-version, or
uninstall evidence, so `installedLocal` applies only to macOS.

The reproducible local Windows archive built twice from the same source commit is
8,094,598 bytes with SHA-256
`4cdacd903aee1ab7aeafc9943258f42cf8522b19a8eda3e4f618b963c0a2f392`.

The 2026-07-29 refresh used Go 1.25.7 on Darwin arm64. The hashes changed
from the earlier local evidence while the source inputs and archive byte counts
remained unchanged, so the release record now binds the build toolchain as well
as the source commit. Both archives reproduced byte-for-byte across two fresh
builds in the recorded environment.

Desktop currently opens the product in the user's default browser while owning
the local service lifecycle; it is not represented as an embedded native WebView.
