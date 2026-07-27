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

The reproducible local macOS archive built from source commit
`89a180911e40d66e47789eab419dff21d93a42d8` is 7,377,978 bytes with SHA-256
`f29f1c643b265d428a57664cba30ef1182220fba2ebe24925c456fbe61c18042`.
A fresh copy installed in the user Applications directory returned this exact
commit from `/version`, a ready health response with live funds disabled,
Prometheus build/risk signals and the YNX Quant Lab frontend title.

## Windows

The x64 candidate contains the same supervisor/API/web/assets layout and was
cross-compiled into an archive. It is `unsigned-cross-compiled`. There is no
Windows host launch, installation, antivirus/SmartScreen, minimum-version, or
uninstall evidence, so `installedLocal` applies only to macOS.

The reproducible local Windows archive built from the same source commit is
8,094,601 bytes with SHA-256
`2de53945d3bc81989693954f0dba5da2a88710e139f9808d40b19bd2b9400fc0`.

Desktop currently opens the product in the user's default browser while owning
the local service lifecycle; it is not represented as an embedded native WebView.
