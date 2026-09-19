# Wallet Web public deployment evidence — 2026-09-19

This checkpoint records the coordinator-verified public deployment of Wallet Web PWA source `8ae417282bdeccbb546923c1ac1b46dbedf3dc8d`. It contains no credentials, cookies, tokens, private keys, signing material, or account data.

The Vercel Preview deployment `dpl_22QYh6wRpdvPjpBsMYWNZdhWCx7C` reached `READY`. Its alias remains protected by Vercel and is not counted as a public entry point.

The Vercel Production deployment `dpl_EGtVy436yNRH3HiDkauJ4g3q86xC` reached `READY`. Its immutable deployment URL is `https://wallet-cxrykyy3s-jiahaoalbus-projects.vercel.app`, its automatic production alias is `https://wallet-web-weld-eta.vercel.app`, and the official `https://wallet.ynxweb4.com` alias was explicitly moved from old deployment `dpl_8NCJWrJjdfUVSrQkr12HBL1dG7Fr` to the new production deployment.

Public readback proved the exact source and immutable authorities, a complete 24-entry asset-integrity module, a verified service-worker shell marker, a fail-closed public Core Auth binding, and `Cache-Control: no-store` on both build identity and service worker. Interactive in-app-browser verification showed the YNX Wallet Testnet companion title, chain `6423` / `0x1917`, and the truthful Wallet unavailable/install state with zero console warnings or errors.

The public release claim is limited to the Wallet Web PWA runtime and website entry point. Installer download hosting, production signing, store publication, account authorization, message signing, and transaction submission remain false.

Rollback commands are recorded in `rollback.json`. They were not executed while creating this checkpoint.
