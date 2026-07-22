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
`eb3767a48d51287f6b4601e0f712a18e734752a7` is 7,338,285 bytes with SHA-256
`235d36c3b362f79607ef70147b991f3e4289591c2930a4aaab00525e0c0c7590`.

## Windows

The x64 candidate contains the same supervisor/API/web/assets layout and was
cross-compiled into an archive. It is `unsigned-cross-compiled`. There is no
Windows host launch, installation, antivirus/SmartScreen, minimum-version, or
uninstall evidence, so `installedLocal` applies only to macOS.

The local Windows archive built from the same source commit is 8,072,676 bytes
with SHA-256
`72270d4fd26da41e445ad45c49a8e099841131f19b4a8d761952e39b012baa91`.

Desktop currently opens the product in the user's default browser while owning
the local service lifecycle; it is not represented as an embedded native WebView.
