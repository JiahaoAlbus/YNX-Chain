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
`2ff74fa60d9c539adef1e5549358667193016e84` is 7,377,976 bytes with SHA-256
`589a2b3db7252c9330b49a95eaf7b8170e9ff2188660d1fb10413cfe7199f056`.
The fresh cold start returned this exact commit from `/version`, a ready health
response with live funds disabled, Prometheus build/risk signals and the YNX
Quant Lab frontend title.

## Windows

The x64 candidate contains the same supervisor/API/web/assets layout and was
cross-compiled into an archive. It is `unsigned-cross-compiled`. There is no
Windows host launch, installation, antivirus/SmartScreen, minimum-version, or
uninstall evidence, so `installedLocal` applies only to macOS.

The reproducible local Windows archive built from the same source commit is
8,094,601 bytes with SHA-256
`1330099d4233b4325eb73a6b189c9aaf6ab015bf0b1b7bbe9bfe5beac36fdd7c`.

Desktop currently opens the product in the user's default browser while owning
the local service lifecycle; it is not represented as an embedded native WebView.
