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
`5c8524035e4dfe628331ca3953d5a75b0b6a8cf7` is 7,337,643 bytes with SHA-256
`93667642db45e38d5c8a2ee338ee0ebf92747c7ac483991cf5b3dedf8d66859c`.

## Windows

The x64 candidate contains the same supervisor/API/web/assets layout and was
cross-compiled into an archive. It is `unsigned-cross-compiled`. There is no
Windows host launch, installation, antivirus/SmartScreen, minimum-version, or
uninstall evidence, so `installedLocal` applies only to macOS.

The local Windows archive built from the same source commit is 8,073,050 bytes
with SHA-256
`cc151dabc4f3b002e5df3814433f5ef1fa83eb916756b825dc5ac3974ed52304`.

Desktop currently opens the product in the user's default browser while owning
the local service lifecycle; it is not represented as an embedded native WebView.
