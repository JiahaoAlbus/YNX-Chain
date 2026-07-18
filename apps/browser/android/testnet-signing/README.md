# Public Testnet Preview signing key

`YNX_BROWSER_PUBLIC_TEST_ONLY.keystore` is an intentionally public, disposable RSA-3072 key used only to make Android Testnet Preview upgrades stable across local and CI builds.

- Alias: `ynxbrowserpreview`
- Store/key password: `android`
- Certificate SHA-256: `BF:49:81:AD:3F:7D:0F:B2:F0:87:BA:76:F1:79:28:04:75:72:7C:08:A8:0A:BB:D5:8A:DC:F3:FE:71:80:15:0B`
- Certificate subject: `CN=YNX Browser Testnet Preview, O=YNX Development, C=CN`
- Validity: 2026-07-18 through 2036-07-15

This is not a secret, production, Play Store, operator, or hardware-backed key. Releases signed by it must remain labeled Testnet Preview. Production publication requires a separately controlled signing identity and a new evidence manifest.
