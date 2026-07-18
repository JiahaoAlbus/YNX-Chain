# Wallet evidence index

## Runtime images

- `proof/ynx-wallet-locked-current.png`: latest API 36 phone cold launch, English/light/empty onboarding.
- `proof/ynx-wallet-arabic-main.png`: Arabic security copy and mirrored RTL header/layout.
- `proof/ynx-wallet-arabic-rtl.png`: complete twelve-language selector in RTL mode.
- `proof/ynx-wallet-dark-large-text-rtl.png`: dark appearance, Arabic RTL and device font scale 1.3.
- `proof/ynx-wallet-fold-large-screen.png`: 2076×2152 unfolded/foldable large-screen layout.
- `proof/ynx-wallet-authorization.png`: canonical Wallet authorization review.
- `proof/ynx-social-product-session.png`: separate Social package product-device session proof.
- `proof/ynx-social-replay-rejected.png`: callback replay rejection proof.

SHA-256 and byte sizes are recorded in `artifact-manifest.json`. The latest Android install used `com.ynxweb4.wallet/.MainActivity` on API 36 and returned `LaunchState: COLD`, `TotalTime: 2140 ms`, `WaitTime: 2274 ms`; a second cold launch returned 477/513 ms with Wallet as the focused activity. The foldable cold launch returned 15082/15742 ms at physical size 2076×2152.

## Protocol and chain evidence

- `packages/wallet-auth/testdata/signer-v1.json`: deterministic Wallet approval vector.
- `packages/wallet-auth/testdata/gateway-p256-v1.json`: P-256 product-device challenge vector.
- `packages/wallet-auth/testdata/central-lifecycle-v1.json`: restart and revocation lifecycle vector.
- `packages/wallet-auth/testdata/mobile-native-transfer-v1.json`: exact JS/Go native-transfer vector.
- Public-testnet transfer hash `0x7bdf19361936215c8bc753696ce61d78ed089f755eac2d8af5cbfbcb1fdc94b2`: scalar-1 test-vector account, amount 1, fee 1, nonce 2. The authoritative account response subsequently reported balance 87 and nonce 2. This is test-vector/testnet activity, not production funds.

## iOS evidence boundary

The iOS project plists parse, `com.ynxweb4.wallet`/`ynxwallet` are configured, the iOS Hermes export passes and `.github/workflows/wallet-ios.yml` parses. This host exposes only `/Library/Developer/CommandLineTools`; `xcodebuild` requires full Xcode, `simctl` is absent and CocoaPods is absent. Therefore native iOS installed-local remains false and the checked runnable CI is the available evidence, without claiming an executed Simulator build.
