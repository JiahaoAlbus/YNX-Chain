# YNX Exchange native app

Native Android/iOS client for the YNX-owned deterministic testnet venue. Package ID: `com.ynxweb4.exchange`; deep-link scheme: `ynxexchange`; Wallet callback: `ynxexchange://wallet-auth/callback`.

The app vendors the accepted Task 1 Wallet Auth v1 protocol source under `vendor/wallet-auth` so its canonical request, compact lower-S secp256k1 approval verification, P-256 product-device proof, replay binding and Central Gateway completion format stay exact. Exchange requests sorted least-privilege scopes: `exchange:ai`, `exchange:deposit`, `exchange:read`, `exchange:trade`, `exchange:withdrawal-review`. A valid Wallet approval cannot become an Exchange session unless the central registry and Gateway routes accept this product; missing integration is shown as unavailable.

Runtime variables (not secrets):

```sh
EXPO_PUBLIC_YNX_EXCHANGE_API_URL=http://10.0.2.2:6442/api
EXPO_PUBLIC_YNX_EXCHANGE_GATEWAY_URL=https://approved-gateway.example
```

No Gateway URL is committed. Without one, public deterministic market state remains readable and Sign in fails closed after Wallet approval. Order/withdrawal controls remain disabled until a central session and Wallet action-review route exist.

Checks:

```sh
npm run check
cd android && JAVA_HOME=/opt/homebrew/Cellar/openjdk@17/17.0.17/libexec/openjdk.jdk/Contents/Home NODE_ENV=production ./gradlew :app:assembleRelease
```

The project contains generated native `android/` and `ios/` sources. Android APKs and all other build output are Git-ignored. The local release variant uses debug signing strictly for emulator feasibility; it is not production/store signing. Full iOS build/simulator proof requires full Xcode, which is not installed on the current machine.
