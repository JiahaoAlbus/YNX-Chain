# Exchange direct public guest readback

Owner source predecessor: 63e0738ee90ab694dd759bde94b323b52d130ba6. Public runtime is not this source. Latest metadata readback recorded in `apps/finance/evidence/financial-owner-release-inputs-20261003.json` binds `/api/version` to 91c1a40587d28ad4c931d4a4d601766bd467ea20, HTTP 200, 107 bytes, SHA256 b4c022607d648d184914ec7e9041fc4e7c5c2ce5fcc13392f18350bfc2a6d8a8. This observation does not assert that version identity cannot subsequently change.

On 2026-10-03 at approximately 06:37–06:38 UTC, Computer Control opened the real `https://exchange.ynxweb4.com/` in a temporary Codex in-app browser tab. It was not a local route fixture and no provider or cookie was injected. Non-sensitive public behavior only:

- English venue/testnet labels and separate private-account panel are visible.
- The panel reports `PRIVATE_SESSION_RETRY_REQUIRED`; public order depth and retained venue matches still load, labeled `Connected · single-host test data`.
- Semantic click on `Reconnect market data` updated the visible source observation to 14:37:55 local time without navigating away from `https://exchange.ynxweb4.com/#assets`.
- Reload initially showed loading then visibly returned to connected public data; source observation read 14:38:04 local time. One temporary browser tab was listed; no blank extra tab was observed during these read-only actions.
- Private account snapshot remained unverified. Standard Wallet approval, account binding, signatures, orders, transactions and multi-user public flows were NOT RUN.

Observation limitation: an initial numeric-index click returned a stale-element error; the next state was #assets. Do not claim that numeric click succeeded or that its navigation was fully explained. The subsequent verified reconnect used the freshly observed named button. No browser network fault was injected, so this is reload/retry evidence, not a real offline-network-loss proof.

Direct unresolved public differences:

1. Chart visibly says `No matched price yet` although the recent-match table contains historical venue rows. New owner source already has tested retained OHLCV display; do not call that source published.
2. Public header still displays a letter Y tile, not the original YNX Logo required by current release direction. Owner source already carries the original image; final release graph must preserve it.
3. Public page lacks the newer interval/trace and UI preference controls present in current owner source. The release owner must assemble accepted SDK/Auth graph and these ordinary deltas, refresh pins and deploy the final compatible version with rollback.

Tool-inline screenshot was observed, but no durable PNG file/hash was captured; do not claim screenshot artifact delivery. Temporary tab was closed. No SSH, deploy, account request, signature, transaction or private-data mutation occurred. Full goal and public current-source acceptance remain incomplete.
