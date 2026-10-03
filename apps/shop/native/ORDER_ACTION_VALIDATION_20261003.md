# Original Native Buyer order actions

The existing Android and shared iOS/macOS applications now present an explicit form for review, return, refund and dispute. Review starts without a selected rating. Resolution reason and optional explanation are separate user inputs. Cancel and delivery require explicit confirmation. A form creates no intent until Submit. Original transition envelope, encrypted storage service, pending queue formats, SDK bytes and action authority remain unchanged.

The form is bound to its original order and active private session. Leaving Orders, backgrounding and account replacement cancel presentation. The Apple model checks original context before dispatch and validates the target receipt before acknowledging an intent. Android checks current session, privacy generation and view before submission and dispatch. Existing unresolved transition records remain stored and block a replacement intent; no current status is treated as acknowledgement. The current Native recovery still cannot authoritatively resolve old transition intents: those rows remain retained, without automatic POST or deletion.

## Reproduce with installed dependencies

Run from the original checkout:

```sh
JAVA_HOME=/Library/Java/JavaVirtualMachines/openjdk-17.jdk/Contents/Home ANDROID_HOME="$HOME/Library/Android/sdk" node apps/shop/native/scripts/verify-order-actions.mjs --android
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer node apps/shop/native/scripts/verify-order-actions.mjs --apple
```

The script creates a new preserved temporary copy, uses existing dependencies, saves raw logs and stops on a failed build. Apple verification first requires the user to have completed Xcode agreements and first launch. It never accepts agreements, changes the global developer directory, downloads runtimes, installs apps or signs a release. The original Xcode project and YNXShop/YNXShopMac schemes are built with Debug signing disabled for source verification. A remains the formal signing/release owner. iOS team, original entitlements, exact Native iOS authority tuple, real device validation and TestFlight upload remain distinct inputs/gates; no secrets belong in these logs.

## Current checkpoint

Android isolated current-source debug assembly and 34 targeted JVM checks passed. Final actual Apple model/API controlled checks passed 41 cases, including original-context checks before dispatch and retained queue on account replacement. Complete original YNXShopMac macOS Debug and YNXShop iOS Simulator Debug builds also passed, with signing disabled, using only process-local DEVELOPER_DIR and installed SDKs. Full SwiftUI application compilation is now verified for these two source candidates; installed runtime/private Wallet/user acceptance remain separate.

Xcode was installed and initialized during this work: actual /Applications/Xcode.app metadata is version 27.0, build 25183.107.5, with iOS/iOS Simulator/macOS 27.0 SDKs. An initial check returned license-required exit 69; after the user completed normal first initialization, the next first-launch check and complete verification passed. No automatic license acceptance or global developer selector change occurred. The old CLT/missing SwiftUI macro blocker no longer applies to current source builds. Tests use injected HTTP/authority/storage and do not prove real Wallet approval, private production routes or installed user acceptance.
