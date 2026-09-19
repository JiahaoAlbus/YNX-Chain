# YNX Wallet security review — 2026-09-19

## Executive summary

The Wallet/Auth review found no reproducible P0, P1, or P2 issue in the extension, Desktop, or mobile transaction controls at source `7eb0beef4f3b1199ee817441d6cc04346e511765`. Targeted security regressions passed 430/430. The public Wallet PWA did have one medium defense-in-depth gap: its production HTML response lacked a Content Security Policy and explicit anti-framing headers. Commit `fd290cbf4e76dbf35f76b00cb7a9886dbcef3c40` fixes that gap and is deployed at `https://wallet.ynxweb4.com`.

## Resolved medium findings

### SEC-001 — Public Wallet PWA lacked a production CSP and anti-framing policy

- **Rule ID:** JS-CSP-001 / JS-CSP-002
- **Severity:** Medium, resolved
- **Location:** `apps/wallet-web/vercel.json:7`; enforcement gates in `apps/wallet-web/scripts/vercel-output-gate.mjs:14` and `apps/wallet-web/test/deployment-policy.test.js:5`
- **Evidence:** Before the fix, the public `/` response had no `Content-Security-Policy`, `Permissions-Policy`, `Referrer-Policy`, `X-Content-Type-Options`, or `X-Frame-Options`. The deployed response now restricts scripts, styles, workers, manifests, images, fonts, network connections, framing, objects, forms, and base URLs to the exact required sources.
- **Impact:** An injection defect elsewhere in the PWA would have had fewer browser-enforced containment controls, and the Wallet page could be framed by another site.
- **Fix:** Added a global Vercel response-header route with same-origin scripts/styles/workers, exact Testnet RPC `connect-src`, `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'none'`, `base-uri 'none'`, `X-Frame-Options: DENY`, `nosniff`, no referrer, and a restrictive Permissions Policy. The four identity and Service Worker authorities keep `Cache-Control: no-store`.
- **Mitigation:** The PWA already escaped dynamic values before its bounded HTML templates and the extension pages already used self-only script/object CSP with two fixed RPC authorities.
- **False positive notes:** None. The missing headers were observed on the public response and the corrected headers were read back from the same official domain.

## High-risk controls reviewed

- The page/content/runtime bridge binds exact origin, top frame, browser tab, document identity, browser context, method allowlist, and request nonce before Wallet work proceeds (`apps/wallet-web/extension/content-script.js:7`, `apps/wallet-web/extension/service-worker.js:215`).
- Sensitive approvals bind account, origin, document lease, deadline, reviewed bytes, and live permission before and after unlock/signing (`apps/wallet-web/extension/service-worker.js:161`, `apps/wallet-web/src/extension-sensitive-policy.js:46`).
- Vault storage uses PBKDF2-SHA256 with 600,000 iterations and AES-GCM with authenticated metadata; browser storage receives ciphertext and public metadata rather than a plaintext private key (`apps/wallet-web/src/extension-vault.js:5`).
- The broadcast journal persists and reads back the exact signed transaction before POST. Acknowledged or unknown outcomes block another send until the exact transaction has a durable receipt; automatic cross-origin replay is prohibited (`apps/wallet-web/src/extension-broadcast-journal.js:63`).
- Faucet admission persists the request identity and body before network access. Unknown outcomes retain the same request ID and do not automatically replay across authorities (`apps/wallet/src/chain/faucetAdmission.ts:57`).
- The public E2E evidence contains public addresses, request IDs, transaction hashes, balances, nonces, and receipts. It contains no recovery material, vault password, private key, signature, or raw transaction.

## Verification

- Wallet Web: 346/346 full tests passed on exact commit `fd290cbf4`.
- Security-focused Web/Desktop/Mobile suites: 430/430 passed.
- PWA, Chromium/Edge, and Firefox packages passed fail-closed verification.
- Vercel Build Output API validation found 24 integrity assets, four `no-store` routes, and one exact security-header route.
- Public browser verification returned source `fd290cbf4`, zero console warnings/errors, zero page errors, and a controlling Service Worker after reload.

## Remaining boundaries

This review does not claim Chrome Web Store, Edge Add-ons, or Firefox Add-ons publication; production-signed Android/iOS/Desktop installers; Android/iOS real-device execution; native production Faucet availability; or consensus finality. GitHub reported dependency alerts on the repository default branch during push, but this scoped review did not establish that those alerts affect the exact Wallet runtime or these shipped artifacts.
