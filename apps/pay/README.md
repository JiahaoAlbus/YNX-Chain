# YNX Pay consumer App

Independent native Expo App (`com.ynxweb4.pay`, `ynxpay://`) for YNX Testnet
payment review. Android and iOS projects are committed under `android/` and
`ios/`; this is not a Web substitute. It accepts scan, deep-link, and manual
invoice lookup; verifies the merchant Ed25519 invoice signature; delegates
sign-in and payment review to the separate YNX Wallet; and shows `committed`
only with authoritative central Pay API transaction evidence.

Wallet sign-in uses the canonical `ynxwallet://authorize?request=` envelope,
Wallet secp256k1 approval, P-256 product-device Gateway completion, exact scope
and session binding, and persistent one-use state. Payment uses a quote-bound
`ynxwallet://intent?request=` envelope. The app and service reject substituted
callbacks, altered amount/merchant/payout/fee/expiry, replayed responses and
wallet results that do not match the signed intent.

Set `EXPO_PUBLIC_YNX_PAY_URL` to the product service URL. Run `npm run check` for
strict TypeScript, parser tests, and Android/iOS JS bundle exports. There is no
fallback to the central Pay API: a build without the product URL fails closed
instead of sending product requests to the wrong service.

The UI supports English, Simplified Chinese, Traditional Chinese, Japanese,
Korean, Spanish, French, German, Portuguese, Russian, Arabic, and Indonesian.
Locale and independent AI output language are persisted across restart; Arabic
uses RTL and amounts/dates are formatted with the active locale. Native camera
privacy strings are generated for all twelve locales.

The App contains no account private key or merchant fixture. Unknown Wallet
broadcast outcomes remain pending until manually refreshed against the service.

On 2026-07-17, a release-variant APK built under JDK 17, installed on Android
emulator `emulator-5562`, cold-launched as `com.ynxweb4.pay/.MainActivity`, and
rendered the native YNX Testnet payment screen without fatal or React errors.
Its SHA-256 is `a0c4c6919042754eb898ab78b06307bcf458965f1e766ac75f0ad9a8e4613934`.
That acceptance build deliberately uses debug signing for local verification;
it is not represented as store-signed or production-distributable.
