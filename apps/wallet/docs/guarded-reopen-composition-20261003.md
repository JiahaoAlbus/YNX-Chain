# Exact guarded reopen composition

Base: d676557e7cf5f408446038fa67efafe22528bb78, unchanged f7c App.

Consumed A's single frozen reopen-f7c.patch, SHA256 32c642672a8e5cde9b844c659bec6408cbab885f15ea1004235fee47d0937e24, from native-app-reopen-f7c-composition-candidate. All eight manifest entries matched bytes and SHA256; current App exactly matched App-f7c-original.tsx before application. Resulting App SHA256: 963440f27c71144040ec6b17cd613ce87d6431ff2aa2b3ee82ac867ff7caf52f. No other App hunk, startup asset, version, shared protocol, or production profile changed.

The effect acquires an unlocked current-account lease, reads the original outbox, recovers against its stored origin, and asserts after awaits before UI. Observed/accepted stays retained; no automatic Done, acknowledgement, retry, key read, signing, or broadcast is added. Existing Pay new/done/retry guards remain outside the applied hunk.

Owned tests extract the actual App effect and exercise the actual WalletOperationLifecycle with controlled IO/UI: nine targets cover accepted retention, lock, account rotation, background, inactivity, expiry, close, read-time rotation, locked entry and empty/done prefill. This is not a mounted React Native or real public recovery test.

Full isolated latest Native source with admitted SDK955 dependency: 908/908 tests, zero failures/cancellations/skips; tsc --noEmit exit 0; Android and iOS Hermes exports exit 0. Logs: /tmp/ynx-wallet-android-inheritance-clean-test-20261003-1ZEdhW/apps/wallet/reopen-full-regression.log, reopen-typecheck.log, reopen-android-export.log and reopen-ios-export.log. Export outputs are QA bundles, not APK/IPA or formal released installers.

Still NOT_VERIFIED: installed OS upgrade/recovery, public business payment and user acceptance, final shared dependency/production protected-port composition, full Native twelve-language App integration, MONSTER. Native signed-origin interface-card mismatch must be reconciled against its original signed tuple before composition; no signed origin was rewritten in this batch. A remains sole issuer and owner of the remaining App/locale/startup integration.
