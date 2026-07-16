# YNX Mail native clients

YNX Mail is an independent mobile product. Android uses package `com.ynxweb4.mail`; iOS uses bundle ID `com.ynxweb4.mail`; the callback is `ynxmail://wallet-auth/callback`; the Wallet registry client is `ynx-mail-v1`.

The clients create a P-256 product-device key in Android Keystore or iOS Keychain, launch the canonical `ynxwallet://authorize?request=...` Wallet Auth v1 request, accept only the exact callback, and retain the signed approval only while central Gateway completion is pending. A callback is never treated as a session by itself.

Drafts and AI-language preference survive restart. Offline sends remain drafts; the app does not invent delivery. Attachments are bounded at 10 MB by the service. AI receives only the selected preview after explicit approval and cannot send mail. The current UI is a native companion to the provider-backed Go service, not an internet-wide SMTP claim.

Build Android with `npm run build:android`. The debug flavor alone permits cleartext loopback development; release traffic requires TLS. Validate iOS source/project with `npm run check:ios`; a real Xcode/Simulator run remains required on a host with the iOS SDK.
