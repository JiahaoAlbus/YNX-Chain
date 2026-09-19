# YNX Wallet iOS Faucet native activation evidence

This evidence binds verified source commit `2f1cab269b88f72125c34c0a736d19a8c16613ae`
and the iOS build 16 candidate to a successful unsigned iOS Simulator build on
GitHub-hosted Apple Silicon. The manually dispatched
[`wallet-ios-faucet-verify`](https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/35459614217)
run completed successfully with Xcode 26.3 and the iOS Simulator 26.2 SDK.

The CI run compiled both `BoundedFaucetHttpEngine.swift` and
`YnxFaucetTransportModule.swift` for arm64 and x86_64, compiled the Expo module
provider that registers `YnxFaucetTransportModule`, bundled the React Native app,
and ended with `BUILD SUCCEEDED`. The resulting Simulator app executable has
SHA-256 `03be20fcf6c93b48891bb02ed2823287d586fd0dc39782eb28b6b53b79cbcd26`;
the normalized app tree hash is
`315c9b4d08e20284d928d5c40ff1d8b471dc515684647271903fcfde3112b5ba`.
The compiled-source gate records `productionEnabled=true`.

The same run passed the 36-case Foundation host suite, 14-case bridge suite,
96 Faucet JavaScript contract tests, TypeScript typecheck, Expo autolinking,
CocoaPods resolution, immutable-source restoration, and the evidence retention
scan. The proof-only artifact is
`ynx-wallet-ios-faucet-verify-2f1cab269b88f72125c34c0a736d19a8c16613ae`
(artifact `10589178921`, 496702 bytes, archive digest
`sha256:98cf11a702f400159dc7e88595910fbd72ea0c7a908ba4f4a12a287b586668bc`).
It expires on 2026-09-26 and contains summaries and logs rather than an installable
app archive.

This proves iOS SDK compilation, Expo/UIKit adapter compilation, and unsigned
Simulator app construction. It does not prove installation or launch in a
Simulator, a runtime read of the native constant, native HTTP execution, a
physical-device flow, a public Faucet request, distribution signing, TestFlight,
or App Store publication. Those gates remain false until their own evidence is
captured.

No public Faucet/RPC endpoint was called. The retained repository evidence omits
raw wire bodies, response bodies, headers, accounts, keys, tokens, the `.app`
bundle, and the 6.5 MB raw build log. `verification.json` preserves the bounded
run identity, hashes, test totals, and exact true/false release gates.
