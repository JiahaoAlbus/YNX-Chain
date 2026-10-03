# Published baseline inheritance — 2026-10-03

This is an owned source integration receipt, not an installation or public user-flow acceptance.

## Exact inputs

The website owner's rendered-DOM/publication-record mapping is preserved at:
`/Users/huangjiahao/Desktop/YNX Project Audit 2026-09-06/website-redesign/wallet-public-version-map-20261003/EXACT_PLATFORM_MAP.md`.
It records Android main download 1.0.28, source `a9fff0d84fe0e4b67a520136ab9c8d4721f6c23e`, code 34; macOS/Linux 0.6.8, source `6f332753baae5deaf6b05c8276b20a02cc4887c5`; Windows 0.6.18, source `1dd948e986ef63e0b57374e9f08f45a0abad5141`; Web 0.1.19, source `c38502f2c4c1be7a3450d12538191b32a4500563`. These are the owner's observed platform records, not binary digests freshly calculated here. The older d58 product-release record is not the Android main-download baseline.

Preserved owned predecessor: `06f596de7b726b46e46f7bb8d3ec5c47be955148`, tree `805ff0214f78a81e6462de3708af900ac5318368`.
Compatible shared SDK remains the read-only A-issued `9555b01e47519a5df882bb0092d2d20e1d7ce6e2`. This batch does not write shared registry, Gateway, Host or release metadata.

## Normal Desktop source integration

The published Windows source had real missing deltas, not merely a higher number. This batch inherits its connection transport, public config, private SDK storage and durable request inbox, and wires them through main IPC and preload into the existing normal renderer. It preserves the owned contract lookup, invoice-reference QR, recipient scanner, receive/share, transaction history, appearance and explicit QA branding additions.

Inherited behavior includes original proposal/request restoration without a new review TTL, account/origin/session binding, pre-sign durable decision readback, terminal decisions across restart, topic-specific expiration/disconnection, bounded pairing with cancel and fresh-QR guidance, and the existing shared Product Session/central browser sign-in methods. Consent additions from the compatible owned SDK are retained. Parser/signature fixtures do not replace registered live authority.

The published proposal IPC also revealed a lifecycle composition conflict: `lease.assert()` deliberately refuses access after outward delivery starts, so invoking it inside `deliver()` cannot approve a connection. The integrated path captures the original lease before delivery and uses `assertEffectCurrent()` to check the same account, generation, focus, deadline and external session binding without reopening key access. A late locked result is locally tombstoned and disconnected; key steps and repeated effects remain forbidden.

Password-vault public reads inherit the published serialization queue, avoiding Windows reader/replacement races. Native replacement diagnostics use only fixed safe stage tokens. A bounded retry is limited to the exact Windows native access-denied category and only after the previous encrypted generation remains private and byte-identical. Unknown moves, other errors and cancellation do not permit a retry. Existing ciphertext/recovery generations and the transaction journal are not migrated or removed by this batch.

## Verification and limits

Dedicated test copy: `/tmp/ynx-wallet-published-inheritance-test-20261003-weuJ6Z/apps/wallet-desktop`.
Full regression log: `published-connection-and-vault-inheritance-regression.log`.
Original tests remain, with asynchronous SDK event fixtures updated; published tests are additionally retained. Synthetic SDK, OS/storage failure injection and accounts are explicitly test-only. No real key, account, Relay or native Windows replacement was exercised.

Both existing QA processes/profiles remain unchanged at the runtime level: PID 52159 for the frozen 06f preferences QA and protected PID 26147. No reload, restart, account/password input or profile cleanup was performed. The preferences QA source directory was restored to the frozen predecessor after test staging; subsequent regression work uses the separate directory above. Current GUI changes are NOT_VERIFIED while the Mac is locked.

This is not complete published-baseline inheritance. Remaining checks include Android a9 transport/receipt/session/UI deltas and code/signature continuity, Desktop published password/locale/readiness UI deltas, platform packaging/install/upgrade preservation, real shared authority/Pay adapter integration and end-to-end user journeys. Native code is unchanged in this batch; its earlier tests are not reported as newly rerun. Desktop/native package versions are deliberately not fake-bumped. A must compose compatible actual source, align manifests/catalog/About, and issue a real non-regressive release before publication. MONSTER remains unrun.
