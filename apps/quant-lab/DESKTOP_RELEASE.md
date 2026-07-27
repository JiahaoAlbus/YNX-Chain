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
`1b7e0f8b15a81e2325fca13e801fd31a192fcdc2` is 7,377,997 bytes with SHA-256
`4fd07c885f8618f19c9960c86b858d9dafb63deb228d6a91737d4d1c7382267c`.
A fresh copy installed in the user Applications directory returned this exact
commit from `/version`, a ready health response with live funds disabled,
Prometheus build/risk signals and the YNX Quant Lab frontend title.

## Windows

The x64 candidate contains the same supervisor/API/web/assets layout and was
cross-compiled into an archive. It is `unsigned-cross-compiled`. There is no
Windows host launch, installation, antivirus/SmartScreen, minimum-version, or
uninstall evidence, so `installedLocal` applies only to macOS.

The reproducible local Windows archive built from the same source commit is
8,094,616 bytes with SHA-256
`0e7fda315ed2856b7b0346a2150324721d9252e7e29197424731cd154040a133`.

Desktop currently opens the product in the user's default browser while owning
the local service lifecycle; it is not represented as an embedded native WebView.
