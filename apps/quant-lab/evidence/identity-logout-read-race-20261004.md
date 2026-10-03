# Quant identity logout/read race

Predecessor abc95c4ba691f2afd64ade4d38a06eaf2e9a4365. Changes only ordinary browser identity consumer and direct Chrome test. Shared routes, cookie/CSRF semantics, private scope and Wallet runtime are unchanged.

Existing consumer had no logout single-flight or result-generation fence: an account GET started before signout could return after its confirmed completion and restore the old identity. Two clicks could send two logout POSTs. The current consumer advances an identity revision at logout/explicit login, ignores retired read success/failure, and clears a pending operation only if it is still that exact operation. Logout captures the already-verified CSRF input once, coalesces repeat requests and background rechecks, disables the exit button during the request, and emits one confirmed identity-context event. An unconfirmed failure preserves account, shows existing localized unavailable text, restores the control and permits explicit retry; it does not invent revocation.

Actual Chrome regression: 3/3 PASS, no skipped. Direct real consumer code bundled in memory; simulated same-origin identity endpoints, not real Wallet approval. The new test separately holds old reads with success 200, refusal 401 and service failure 503, submits two exit calls and a concurrent read, proves identical pending promise and one logout request, no additional focus GET during exit, exact original POST body/header, then releases old reads after confirmed logout. Old account cannot reappear, exactly one context event occurs, one tab and zero page errors. In the 503 scenario the first logout also fails, leaves suppression unset/account visible/button enabled, and a second explicit retry confirms logout before the old read returns. Existing guest/no-navigation and twelve-language identity/logout tests remain green.

Business-flow + ui-maturity: 90/90 PASS, no skips, 564.316084 ms. App module syntax and git diff --check PASS.

Publication: source only. Inherited wallet-auth bundle and formal asset graph are not rebuilt here; prior QUANT_ASSET_HASH_MISMATCH:styles.css is not resolved by this consumer change. Sole release owner must inherit the browser-sso hunk and prior guest/research changes, rebuild the compatible final bundle/graph and verify public identity/private business lifecycle. No Host mutation, account grant, signing, execution or installation action. Local UI proof does not establish real session revocation or full product completion.

Rollback is inverse of ordinary consumer/test hunks; no production state changed.
