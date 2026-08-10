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

The current local macOS archive built from source commit
`70382c37ccb8c601c88e72c4cbe189fa072dc5db` is 7,395,201 bytes with SHA-256
`b7f0013ab789f36d8013ee35131b19d92b09d201daac9560c4f989a568cd60d3`.
The fresh cold start returned this exact commit from `/version`, a ready health
response with live funds disabled, Prometheus build/risk signals and the YNX
Quant Lab frontend title. The machine-readable record is
`apps/quant-lab/evidence/local-macos-desktop-cold-start-20260810-70382c37.json`.

## Windows

The x64 candidate contains the same supervisor/API/web/assets layout and was
cross-compiled into an archive. It is `unsigned-cross-compiled`. There is no
Windows host launch, installation, antivirus/SmartScreen, minimum-version, or
uninstall evidence, so `installedLocal` applies only to macOS.

The local Windows archive built from the same source commit is 8,110,427 bytes
with SHA-256
`a8a2e25e6bdc6a244ca09f491671951a2e0ae210c32b9f17758a31569d4eb1ab`.

The 2026-08-10 refresh used Go 1.25.7 on Darwin arm64. The release record binds
the toolchain and source commit. The macOS package passed strict ad-hoc signature,
fresh extraction, exact version/commit, ready health, frontend identity and clean
shutdown checks; Windows remains host-unverified.

Desktop currently opens the product in the user's default browser while owning
the local service lifecycle; it is not represented as an embedded native WebView.
