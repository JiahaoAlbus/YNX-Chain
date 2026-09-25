# Frozen Wallet Web 0.1.3 page QA

- Product source: `31f3ef16d3812870e0c3d23350565fd592482227`.
- Exact PWA ZIP: `ynx-wallet-web-pwa-0.1.3.zip`, 315715 bytes, SHA-256 `478e155646f7e269e7b075666362b904b57ad949ae101c3d5319f48aca76d5eb`.
- Exact Chrome/Edge extension ZIP: 584777 bytes, SHA-256 `5c6ff4c16805965aa86febdc6a9f7a812ea2d1e9c8fa556611dafeadfb2e707b`.
- PWA `app.js`: `3c0d9d03874abb5943e1b38e8d372d9f55c8e7570eabdbb4579b3a53e34a9c2d`; `sw.js`: `b2a2b514c823bcf00a3f5ad82d914a0aab58d39738de7471a8457681799fc4f3`; `build-identity.json`: `aa2c875989d8922066e679a447956aeb290976982e7673211fce538e6329b588`.
- Chrome for Testing and Microsoft Edge: frozen PWA page in a local static server with a simulated EIP-1193 provider passed refused connect, unconnected `#switch`, canonical `#add`, approved connect, refresh and same-account restore, and revoked account after switch. See `pwa-page-chromium.json` and `pwa-page-edge.json`. The simulated provider does not prove live extension connectivity.
- Chrome for Testing and Microsoft Edge: frozen extension ZIP in a disposable HTTPS DApp profile passed vault UI creation, deletion of the separate provider index, browser cold restart, index reconstruction from the unchanged encrypted vault with the same public address, revoked site grants, and `eth_accounts` remaining disconnected. See `extension-index-chromium.json` and `extension-index-edge.json`.
- Chrome for Testing: exact historical v8 service worker upgraded to the extracted frozen PWA ZIP, removed the old cache, rejected a broken successor, and kept the complete candidate on browser restart. See `pwa-v8-to-build-upgrade.json`.
- Scope limits: no real user wallet data, live RPC/account authorization, public deployment, installed PWA, browser store release, or user device was used. The public site must be re-read after deployment. This QA does not validate desktop installers.
