# Desktop release status

## macOS

The arm64 `.app` candidate contains the desktop supervisor, Quant API daemon,
web daemon, and versioned web assets. It stores state in the user's application
configuration directory, binds only loopback ports, waits for health before
opening the browser surface, and terminates child services with the supervisor.

Direct evidence: cross-build passed; ad-hoc deep signing and strict verification
passed; a copy installed in the user Applications directory; an installed cold
launch returned the Quant product/version endpoint and frontend HTML; live funds
remained disabled. Signing class is `adhoc-test-only`. Apple Developer ID,
notarization, hardened-runtime entitlement review, immutable hosting, and store
release are false.

The local macOS archive built from source commit
`c140404cbfaca5f01a2db05af3d9a544652ac8f6` is 7,361,745 bytes with SHA-256
`8d9d9c16af94ad5156f3c6babfb7b287e9dc6d22ab622340f4138a25b44ee201`.
The installed cold launch returned this exact commit from `/version`, a ready
health response with live funds disabled, Prometheus build/risk signals and the
YNX Quant Lab frontend title.

## Windows

The x64 candidate contains the same supervisor/API/web/assets layout and was
cross-compiled into an archive. It is `unsigned-cross-compiled`. There is no
Windows host launch, installation, antivirus/SmartScreen, minimum-version, or
uninstall evidence, so `installedLocal` applies only to macOS.

The local Windows archive built from the same source commit is 8,095,087 bytes
with SHA-256
`f67fad932b6851b22a327faf98217e3070e3cd256e1f9e0495c9e4eb55f58e6b`.

Desktop currently opens the product in the user's default browser while owning
the local service lifecycle; it is not represented as an embedded native WebView.
