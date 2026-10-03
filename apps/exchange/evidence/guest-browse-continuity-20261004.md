# Exchange guest browse continuity and release handoff

Predecessor: 5f24e9e3412dd2be5a77d67f8ec8d6dc4f186dc2. Shared owner's direct contract clarification: SilentAllowed permits an identity-only attempt but does not prove this guest has a restorable family/grant, does not require /sso/start navigation and grants no private write permission.

The ordinary consumer now retains its guest page after same-origin account 401/403. It no longer starts top-level prompt=none navigation from background identity reads or an enabled/silent config. Account 200 from an existing identity cookie still restores identity:read only; explicit fixed SSO anchor remains the only login navigation. No shared marker/config/cookie/SDK changed. Standard Wallet/private read separation is preserved. There is no new returnURL or authorization route.

Actual controlled Chrome guest regression: config enabled=true/silentRestoreAllowed=true, account 401/503/401 -> exact #market URL, selected 1-hour interval and unsubmitted support draft retained; one tab, zero page errors, zero non-GET requests, no /sso/start. Account 200 restores the existing read identity; subsequent 401 clears it. Explicit click alone causes one GET /sso/start?target=market. No real account approval/signature or private business write.

Executed tests:

- browser-identity-response + owned-controls-browser + locale-browser: 40/40 PASS, no skipped, 22271.165167 ms. Includes native Chrome response streams, current-language late states, draft/node preservation, real chart/record renderers, explicit controls and logout fencing.
- Combined private-account + owned-controls + ui: 45 PASS, 1 opt-in QA skipped, 1 formal asset gate FAIL. The failing test is retained, not relaxed: EXCHANGE_ASSET_HASH_MISMATCH:styles.css.
- Verified the same asset failure in exact predecessor Git objects: CSS actual 05cc5bb35872b4f3c33182bc25a9055760fabde6d548a999ebcca3992626f198 vs HTML pin 4282c2f68785230be3acc6a39108f6e7af7ea5995c91256f40849dde24f4f666. Not introduced by this guest fix.
- node app syntax + git diff --check PASS.

Frozen inherited static graph inventory (path under apps/exchange/web; byte count / git blob / SHA256):

| File | Bytes | Blob | SHA256 |
|---|---:|---|---|
| index.html | 20271 | 344a85a2443bac2b41cdb2b3aef2ba7cfd51c6b5 | c24b5388851c40b55aee1708713830de57a3ca56bfeda54a6a393e45617119d8 |
| styles.css | 13302 | 0f069a50737d0871b7c0402880f9a49ccb09805e | 05cc5bb35872b4f3c33182bc25a9055760fabde6d548a999ebcca3992626f198 |
| wallet-connect.js | 37764 | ad04fe2768b68bb46285ba92ceb785d6396365d0 | a031dab0a4422157a11450cc69d098b404030b8503dd0284892e621e835d45b6 |
| app.js | 44671 | a65f34ff0ad821efba7568abf59f87f80828ca99 | 801a2d3eb1924b83908fd01d531543b4f9406736a08c5487ca27f240d21ac789 |
| market-data.js | 15941 | c526c0f0f486ccad24dd9cb1f2a0a0d01069c186 | cd6c06338a9fdfaf1889f79ac324b527412197a35ef2ce0e025fbcfd644525b6 |
| order-preview.js | 4591 | 5856da73de2b602de918389b55bd3cf88cc3a3f3 | 70465b431e6f22d85f1cc6a1f9d569d611b5662af06fa379cd5c27d03ef12ad3 |
| private-session.js | 136529 | e698528d5a4d20b7efb175546486d1c7736fcfeb | ef1b89eef8e13e2ad27bc8893c5d4f09bf8c9fe21bb3b54498e34eb828a74675 |
| locale.js | 170803 | 94bb8a9d30e3285df7edff3117ed5f7be60f32b6 | b8b7ce7e1a7e3ea487c246f5cbdba733db88f2fd74a8442e764f9341bfae0781 |
| ui-preferences.js | 2241 | bc9afab56074071d45d1d3f225364b37254b6c61 | 5557ed0d8c0ea3bbf36c5aae73b4f17453ce346ee3910788d50af19997f15d45 |

This inventory freezes actual inherited local bytes, NOT a coherent releasable graph. The sole release owner must inherit ordinary chart/trace/locale and bounded-consumer hunks, rebuild private-session from the changed private-account-controller source in predecessor, then derive all final hashes/pins and full graph verification from that integrated build. Do not publish the stale inherited bundle as consuming the new stream helper. Do not whole-overwrite Finance authority or the release owner's graph. No formal bundle/pin/Host changes were made here. Public source-bound acceptance remains false for this correction.

Rollback: inverse of ordinary guest/helper/test hunks only; no production operation occurred. Original failed asset gate and controlled-only evidence classification remain explicit.
