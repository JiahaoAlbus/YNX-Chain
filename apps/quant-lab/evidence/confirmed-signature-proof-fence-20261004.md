# Quant confirmed signature fence

Source commit: 65e83ed78343815b9d44c9b6d75b2884e31aaa3b.
Tree: 03cd26ed7adc65238e3166e7a203ddc1c94a1fda.

The Testnet submission previously read the signature input after asynchronous Product Session proof acquisition. An edited signature could therefore replace the input present at confirmation. The handler now captures the trimmed signature alongside the exact order review, checks it after confirmation and again after proof, and sends only that captured value. Changes stop before the order POST, retain the preview/input for explicit review, localize the existing changed-preview message, and release the single-flight control. No automatic retry or new protocol is introduced.

Executed engineering checks:

- `node --check apps/quant-lab/web/app.js` and `git diff --check`: passed.
- `node --test apps/quant-lab/tests/business-flow.test.mjs`: 114 passed, 0 failed, 0 skipped; 1253.848708 ms. Twelve-locale delayed-proof signature replacement rejects without any order request.
- Final exact-receipt outbound signature assertion: `node --test --test-name-pattern='Testnet confirmation binds|exact confirmed Testnet receipt' apps/quant-lab/tests/business-flow.test.mjs`: 2 passed; 105.189625 ms.
- Real local Chromium form regression: `node --test apps/quant-lab/tests/order-risk-preview-browser.test.mjs`: 1 passed, 0 failed, 0 skipped; 1995.418667 ms. Actual form confirmation and delayed controlled proof exercised; edited signature causes zero execution POSTs, retains preview/signature, unlocks button, and does not create a tab or page error.

The initial browser regression timed out at proof admission because the newly extended fixture omitted required mandate/key fields. Native form validation correctly blocked it. Those fields were supplied before preview; no validation bypass was added.

All signatures/proofs used by tests are explicit controlled strings, not real account authority. No real Wallet approval, signature acquisition, order execution or public/installed verification occurred. Formal asset composition/public deployment remains A-owned. Unknown Testnet intent recovery across reload remains a distinct unfinished gate; this change does not claim to solve it.
