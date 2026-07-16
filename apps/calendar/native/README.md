# YNX Calendar native clients

YNX Calendar is an independent mobile product. Android uses package `com.ynxweb4.calendar`; iOS uses bundle ID `com.ynxweb4.calendar`; the callback is `ynxcalendar://wallet-auth/callback`; the Wallet registry client is `ynx-calendar-v1`.

The clients create a P-256 product-device key in Android Keystore or iOS Keychain and issue the canonical Wallet Auth v1 request. Only the exact callback is accepted, and central Gateway completion is required before a session exists.

Event drafts, recurrence choices, time zone, offline queue state, product locale and AI-output locale survive restart. Every event mutation is reviewed before apply. AI sees only selected event context after approval and cannot invite, change, or cancel. External invite/reminder delivery is provider-dependent and is not described as production delivery.

Build Android with `npm run build:android`. The debug flavor alone permits cleartext loopback development; release traffic requires TLS. Validate iOS source/project with `npm run check:ios`; a real Xcode/Simulator run remains required on a host with the iOS SDK.
