# Direct public entry observation - bounded, not release acceptance

Observed: 2026-10-03T11:38:35.989Z. URL https://social.ynxweb4.com/.
Owner base: 8ed1aa0a384565901d51fa0d4dfbd9dea7ef35f8. Deployed source/tree/deployment ID: NOT_VERIFIED.

Actually opened the real HTTPS page in the in-app browser, clicked only the entry chooser button, saved the visible chooser screenshot, closed it and refreshed. No provider row, account grant, signature, transaction, private conversation or installation action was requested. No synthetic providers or accounts were injected.

Verified bounded observations:
- Document language is English; guest public content renders while the UI reports private service degraded.
- Chooser displays distinct YNX Wallet and MetaMask names and visible logo assets. This does not prove actual injected provider identity, rdns, account binding or logo provenance acceptance.
- Chooser close returns to the original page, refresh remains at the same HTTPS URL, and one same-origin tab was present in the observed browser inventory. No blank page in these transitions.
- Console captured zero warning/error entries for the observed tab through close/refresh. Not a network/security audit or a guarantee across all flows.
- Header still visibly uses a Y-letter mark, not the required original ecosystem Social logo.

Actual public app.js read over HTTPS: 6928 bytes, SHA256 966a47ae3d285a625ab666ddeca91defa156f04337b700fc07bd6c73e97ee51d. HTTP 200; ETag 1f568bea0dfc62f511742b5f2e62c9bb; Vercel edge request ID hnd1::xzx8x-1791027486406-d4d429d4b9de is NOT an immutable deployment identity. Owner web/app.js SHA256 5423cde5dd89aa89b9dd2c032d942702816c4baefeb8c9a58964f7e331a4ec72 differs. No claim that the public app represents the current source, source ecffe336, the combined-authority fix or the full Social v2 client.

Not verified: late/no-provider runtime, approve/reject, 0x1917 switch/readback, accountsChanged/chainChanged/disconnect/revoke, independent DApps, signing/send, WalletConnect, real messaging/Moments/contacts or installed client. This is a direct PUBLIC_UI_OBSERVATION only, not a source-bound E2E envelope or completion. No deployment performed. MONSTER NOT_RUN.

Next required coordination: Central/A supplies exact immutable deployed artifact/source mapping and the compatible runtime/release route. Do not replace the official app with this guest preview, create permissions or deploy based on this observation. Two unrelated uncommitted local filter type fixes remain awaiting the human choice; they are not included in this evidence commit.
