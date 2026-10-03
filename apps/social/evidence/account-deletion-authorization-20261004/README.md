# Account deletion authorization boundary

Base: 5beab844f89545d44f9652e1997227954625d92c.

After a successful existing privacy/delete request and a still-current authorization generation, the client invalidates its local Social authorization. Failed requests retain the original authorization for explicit recovery; late responses after switching authorization cannot invalidate the new account. No new deletion endpoint, authority scope or automatic retry is introduced.

Controlled transport tests cover successful deletion followed by a locked private request, HTTP 503 without local invalidation, and a late successful response after account switching. Full npm test: 381 passed, zero failed/skipped. npx tsc --noEmit: exit 0. Actual Expo Android and iOS exports: exit 0, isolated output /tmp/social-account-deletion-authorization-20261004.XeAVlx.

These are source tests and bundle exports, not signed installation, production deletion, protected backend receipts, OS storage cleanup or user acceptance. Persistent action/report intent cleanup, actual UI error/recovery, original cryptographic identity retention, public delivery and MONSTER remain open. No real account deletion or sensitive Wallet request was performed. Unrelated APK/cache/model/stage artifacts are excluded.
