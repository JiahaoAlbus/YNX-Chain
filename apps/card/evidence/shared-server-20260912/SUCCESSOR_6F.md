# Official 6f332753 server contract consumption

Runtime imports now use Wallet-owner server source `6f332753baae5deaf6b05c8276b20a02cc4887c5`, unchanged 132173-byte artifact SHA256 `a7107b35fc4ea27e0aad4a67f8cabc388d2551e9cc09970ca90a573b7042a520`. The a7 source, artifacts and Node22 evidence remain preserved and source-bound to their earlier checkpoint.

The official successor, not Card-local bypass logic, allows missing Origin for a read-only Web GET. The Card HTTP route test uses an unchanged Wallet-owner public Web fixture and a synthetic authority response. Wrong Origin, a Web write without Origin, absent proof and cross-platform proof selection all fail closed. No forwarded Origin is trusted.

CardBusinessClient sends only a bounded platform selector and the accepted SDK proof. It invokes transport without binding the Card instance as fetch receiver. The first platform-test attempt incorrectly required undefined `this` under a non-strict test runner; the retained failure was diagnosed with a standalone synthetic read showing global receiver, not Card receiver, and successful validation. The corrected assertion checks the actual forbidden Card receiver. No network request outside local fixtures occurred in these tests.

`successor-02`: 90 local backend/client/platform tests passed; application/server typecheck passed; Web build passed. These are not direct browser or installed Wallet claims. The Web build occurred before the new source commit and must not be presented as a source-bound public deployment artifact.

Still unproven: complete 6f Node22 candidate runtime (record separately after exact-source archive), new Native bundle/runtime hookup, UI-to-private-backend application flow, controlled Testnet issuer provisioning, production service/routing, real Session and Wallet business approval, real YNXT funding, Data Fabric and installed/public lifecycle. No source-only completion or real-payment promotion.
