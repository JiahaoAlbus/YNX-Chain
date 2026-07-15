# YNX Pay consumer App

Independent Expo App (`com.ynxweb4.pay`, `ynxpay://`) for YNX Testnet payment
review. It accepts scan, deep-link, and manual invoice lookup; verifies the
merchant Ed25519 invoice signature; delegates sign-in and payment review to the
separate YNX Wallet; and shows `committed` only with authoritative central Pay
API transaction evidence.

Set `EXPO_PUBLIC_YNX_PAY_URL` to the product service URL. Run `npm run check` for
strict TypeScript, parser tests, and Android/iOS JS bundle exports. The default
URL is a deployment target, not a claim that the service is currently live.

The App contains no account private key or merchant fixture. Unknown Wallet
broadcast outcomes remain pending until manually refreshed against the service.
