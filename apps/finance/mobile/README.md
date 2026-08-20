# YNX Finance native app

Native-first Expo/React Native client for Android and iOS. It uses the accepted standard EIP-1193 connection through `@ynx/dapp-connect-sdk`.

```bash
npm ci
npm run check
npx expo prebuild --no-install
cd android && JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew assembleDebug
```

For a self-contained local install/cold-start proof, build the release variant
with the Hermes bundle embedded. It is still only locally debug-signed by the
generated project and is not production signing evidence:

```bash
NODE_ENV=production \
ANDROID_HOME="$HOME/Library/Android/sdk" \
ANDROID_SDK_ROOT="$HOME/Library/Android/sdk" \
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
./android/gradlew -p android assembleRelease --no-daemon
```

The bundled Testnet endpoint manifest is the only endpoint source. Finance currently consumes verified REST/EVM RPC/Explorer endpoints for public connectivity; its Product API is `PENDING` and Product Session is `UNAVAILABLE`, so private Finance requests are not sent. Standard Wallet Connection remains available and is not removed when private services are unavailable. The client never creates a local session, device proof, callback, or Gateway completion request.

Cached data is labelled offline and never presented as live. Import accepts only the versioned Finance export envelope. Export includes public account evidence and private planning data and should be stored securely.
