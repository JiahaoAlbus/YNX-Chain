# YNX Finance native app

Native Expo/React Native Finance client for Android and iOS.

## P0 Wallet Connectivity status

The client consumes the accepted `@ynx/dapp-connect-sdk@0.1.0-p0.0` package and the hash-pinned Testnet endpoint manifest `1.0.0-p0.2`. It uses only standard EIP-1193 wallet connection and never creates a device key, Wallet callback request, Gateway completion, Product Session proof, or configurable Finance Gateway URL.

Finance is currently `PENDING` in the accepted endpoint manifest. The app may connect a compatible YNX Testnet wallet, but it must not call a Finance product API until Integration publishes direct product release evidence. The UI marks this as `PRODUCT_SESSION_UNAVAILABLE`, not as a Wallet or whole-app outage.

## Local verification

```bash
npm ci
npm run check
npx expo prebuild --no-install
cd android && JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew assembleRelease --no-daemon
```

A locally built APK is neither public hosting nor production-signing evidence. It must be installed and cold-started on a separately recorded device before being proposed to the central downloads release path.
