# YNX Cloud native client

Expo/React Native source for the Android- and iOS-first YNX Cloud client.

- Package / bundle: `com.ynxweb4.cloud`
- Deep link: `ynxcloud://wallet-auth/callback`
- Wallet client: `ynx-cloud-mobile-v1`
- Default Android emulator API: `http://10.0.2.2:8092/api/v1`

The app stores its session, locale, AI-output locale, and device-bound P-256
secret in platform secure storage. Offline uploads remain in app-local storage
until the user presses Sync. It does not claim that the bundled local object
adapter is public or production-durable storage.

Run `pnpm check` for type, Wallet binding, i18n, and Metro bundle checks. Run
`pnpm prebuild` before native Gradle or Xcode builds.
