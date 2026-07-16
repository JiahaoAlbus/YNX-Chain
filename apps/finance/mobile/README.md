# YNX Finance native app

Native-first Expo/React Native client for Android and iOS. It uses the independent identifiers `com.ynxweb4.finance` and `ynxfinance://wallet-auth/callback`.

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

The default Android emulator endpoint is `http://10.0.2.2:8787`; it can be changed in Settings and persists across restart. The client never creates a local substitute session: Wallet approval must complete at the central Gateway `/wallet-auth/sessions` and `/wallet-auth/sessions/complete` routes. Until the central registry contains `ynx-finance-v1`, sign-in correctly ends as unavailable.

Cached data is labelled offline and never presented as live. Import accepts only the versioned Finance export envelope. Export includes public account evidence and private planning data and should be stored securely.
