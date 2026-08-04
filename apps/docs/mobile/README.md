# YNX Docs native client

Expo/React Native source for the Android- and iOS-first YNX Docs client.

- Package / bundle: `com.ynxweb4.docs`
- Deep link: `ynxdocs://wallet-auth/callback`
- Wallet client: `ynx-docs-mobile-v1`
- Default Android emulator API: `http://10.0.2.2:8092/api/v1`

The app persists session and locale choices in platform secure storage and
keeps unsynced drafts in app-local storage. Autosave uses base-version compare
and swap; conflicts require choosing the server copy or recovering the local
draft as a new document. Presence is a bounded heartbeat and is explicitly not
presented as real-time collaboration.

Run `pnpm check` for type, Wallet binding, i18n, and Metro bundle checks. Run
`pnpm prebuild` before native Gradle or Xcode builds.
