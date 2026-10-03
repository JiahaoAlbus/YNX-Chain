# Original native chat-device retention

Status: PROGRESS, not product acceptance or a deployment lease.

Source: 54c9de3d0f18b421ada4b7929d168c7bf0b48078
Tree: f13c3a1d5b8183574218d3f17968fb3e49ae68e8
Parent: 9b50e47d3a8b97326785c9f78f090acd76f2dfc4
Branch: codex/social-wallet-chooser-20261001

## Original product integration

nativeSessionRuntime.nativeChatDevice now uses a tested serialized protected
store adapter. It retains the original ynx.social.device.v1 active carrier,
ynx.social.session.v1 legacy ownership binding and exact original hashed
per-account archive keys. Device schema and cryptographic generation are
unchanged; OS protected writes retain WHEN_UNLOCKED_THIS_DEVICE_ONLY.

Old-account archive persistence is read back before switching the active
selection. Existing conflicting archives fail without replacement. Empty
existing carriers are corruption, not permission to generate replacement keys.
Legacy ownership without an account-bound carrier requires recovery; keys are
not deleted or rotated. Target and active writes are read back; explicit cold
retry uses the retained archives rather than silently generating new keys.

The queue serializes this app instance only. It is NOT a cross-process Secure
Store compare-and-swap or a new Wallet/account authorization authority. No
account grant, key export, public session enrollment or permission expansion.

## Actual tests

Fourteen added software-storage cases exercise preservation, archived write
failure, lost readback, conflicting archives, old session ownership, unbound
legacy keys, target failure/recovery, overlapping selections, wrong-account
archive, active write failure with cold recovery, and empty corrupt carriers.

Final full native tests: 250/250 PASS, no failures or skipped cases.
Final project type check: exit 0. Original intermediate test-fixture implicit
parameter errors are preserved in typecheck.log; the fixture now uses the
actual ProtectedChatDeviceStorage interface, not any or disabled checks.
Git whitespace check: PASS.

These tests use generated software fixtures, NOT real private user keys,
OS Secure Store acceptance, real multi-account grants or Matrix continuity.

## Actual source-bound JS build evidence, QA ONLY

Android export: exit 0, 2760 modules; iOS export: exit 0, 2762 modules.
Both resolve the existing QA entry's absolute import of the original owned
apps/social/App.tsx. The original YNX PNG asset is included unchanged.

Android QA JS archive: android-js-qa.tar.gz, 2229475 bytes,
SHA256 d268ac29a96100851ac7c05a188c948692ee672d3d961693beacf3a58b7f4ade.
iOS QA JS archive: ios-js-qa.tar.gz, 2227483 bytes,
SHA256 f9d270292706fbe08a33a3b18e8c353fbbadff670e5cbcb975e3452043d13228.
Per-file SHA256 lists and build logs are retained beside the archives.

QA build context is /tmp/ynx-social-native-matrix-qa.aZcKcz. Its node_modules
symlink resolves to the original owner apps/social/node_modules; its own
package-lock.json is absent. Original owner package-lock SHA256 is
3343f4d6da67eeaedb13bde12a288473725c31df61e21df17f3012b48abd436c.
Context file hashes are recorded. This is an existing linked-dependency build,
NOT an independently verified cold dependency installation.

These are partial QA JS/assets archives, NOT APK/IPA installers, signed formal
releases, installed runtime proof or public deployments. No official version
was replaced, and no production or existing installed data was modified.

## Remaining full-goal gates

The original authoritative joint current producer, generic ActionProof/nonce
atomic effect and actual historical Matrix HS/directory/observer mounting are
still not complete. Formal installed/public source-tree/version/provenance and
all original business capabilities must be retained before any release. Real
account/device recovery and cross-node continuity still need actual runtime
evidence. MONSTER/dot was not invoked and remains NOT_RUN; the unique
coordinator has the real validation-channel request. C01-C07/V01-V17 remain
the full Social goal, not reduced to these tests/builds.

Only coordinator: 01a094cc-0ba3-7901-bcd5-56fce8330c0d.
