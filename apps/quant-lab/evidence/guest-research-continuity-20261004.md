# Quant guest research continuity

Predecessor 885c1c76bc198b54e53a229f657a898101c925f9. Ordinary browser SSO consumer only; no shared protocol, server identity authority, endpoint, cookie, formal build or Host mutation.

Consume the shared owner's clarification: SilentAllowed is permission for identity-only recovery, not evidence of a restorable family/grant and not a requirement to navigate from guest. Account 401/403 now clears stale identity and returns in place. No second config read or automatic prompt=none start is issued. An existing identity cookie's account 200 still restores identity only; 503 does not fabricate logout. Explicit login still uses the fixed /sso/start route and original selected view. Explicit logout suppression and notification semantics remain unchanged.

Actual Chrome browser-sso tests: 2/2 PASS, no skips, 1934.4125 ms. Tests compile the real consumer in memory without modifying formal bundles. Guest enabled/silent config plus 401/403/503/401 keep #risk, current strategy draft and fee 17, one tab, zero Wallet requests and zero non-GET requests. Existing cookie response 200 restores identity; later 401 clears it. Initial config 503 does not navigate. Only explicit click starts /sso/start?target=risk. Existing twelve-language identity labels, unavailable read and explicit signout/re-login lifecycle remain covered. Simulated identity replies are not real approval or durable Product Session evidence.

Business/UI/source tests: 97 PASS and 1 formal asset gate FAIL (QUANT_ASSET_HASH_MISMATCH:styles.css), no skips. Kept the failed check; no test weakening. Exact predecessor CSS Git bytes already mismatch: actual SHA256 994b8aaa5a21213b1e4b12e11b75a7b1a6c98cf52794b00e583d6e56b38b6263 vs HTML pin 37f0de0c0d9fadd3b28bca3974be4d56b08a9e9881698baa822bee1b9eced1d5. This guest change did not introduce that release graph gap. node module syntax and git diff --check PASS.

Source consumer identity:

- apps/quant-lab/web/browser-sso.js: blob 2c2eae5cc5f9c513cfd0213f791ded740167a270; 4098 bytes; SHA256 efe3b93fb0282ec4c99ee313074036a0ea1bf822105c72a6e532d6e545a11169.
- Inherited unchanged formal wallet-auth.js: blob 0cf185d0650377678856b59093d5db1adfb88233; 368613 bytes; SHA256 3b8c2afa35f3af7e1810c4101af8457277dc603960526ee1f6b10f80aaec1ac0. It does not prove consumption of this changed source; sole release owner must rebuild the exact compatible bundle.
- Inherited index.html: blob cfc4bae2988322b48e0234d961bd81a7496e5be7; 29178 bytes; SHA256 a68c24f9d2e6ea74874c5fcc57ef7f830515c0442e5ab129ef9ee11e9aef7d32.

Integration: apply the ordinary browser-sso delta together with inherited actual research split/status/copy app deltas, rebuild through the sole release owner, freeze the final graph and pins, then verify source-bound public guest continuity. Do not whole-overwrite shared Wallet graph or Finance authority. No publication/installer/account/signature/transaction proof is claimed. Rollback is inverse of ordinary consumer/test hunks only; no production action occurred.
