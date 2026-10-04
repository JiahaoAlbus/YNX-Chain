# Quant composed native Paper and existing product continuation

This is owned source and local engineering evidence, not public release, installed Wallet approval, real identity acceptance or a Testnet transaction.

## Inherited source

- Composition base: `7443521739b35abb2c029060ea81660f1e61869b` (current financial owner graph). It already contains the product introduction, original YNX branding, display preferences, market/cost/risk and stronger research/Paper recovery.
- Native workspace backend donor: `1b6606996`, applied by three-way cherry-pick as `ff2c091fd72a638a606c1a3d24a31bb3185429ad`.
- Native read consumer donor: `718cc15e457cd2e0fe477e4fd5ae1437d5d7ede7`, applied as `66447df4d0673c33f9aad571416e3b1e12475a22`.
- Native write consumer donor: `8cb0e75ead6895e2db18bbb42025679d84f24015`, applied as `bc54fca009a894df7295ef41e6ce147eaa9ab508`.
- Conflict resolution retains strict existing input validation, request/response binding, durable unknown research journal, single-flight and late-response fences. A separate read-only draft getter feeds the native preview without consuming browser-local authority.
- Historical consumer manifests remain historical; their strict default current-byte gates still reject changed working files. Archive custody is verified explicitly, not promoted to a composed runtime.

## Native Paper risk contract

Dedicated routes, POST only:

- `/v1/wallet/paper/risk/kill`: `{reason, idempotencyKey}`; nonblank 3–500-character reason.
- `/v1/wallet/paper/risk/reconcile`: `{cash, position, idempotencyKey}`; explicitly provided signed integers (browser restricts them to safe integers).

Both require the existing canonical native `quant:paper:workspace` authorization and any configured browser identity binding. Account/tenant cannot be supplied in the body. Owner mapping selects the original durable engine workspace; a legacy tenant, records scope or Standard Wallet connection is insufficient.

Risk mutations reuse original engine semantics. Kill only halts new signals; reconciliation compares an independently verified simulated ledger reference with engine balances, records the difference and latches halt on any discrepancy. It does not replace balances, clear a halt, resume execution, move funds, reconcile Exchange, or grant scheduling/Testnet execution.

Response: verified `account`/`sessionBinding`, `action`, `idempotencyKey`, `requestDigest`, `paper` risk observation. Orders are omitted from this receipt; the owner's snapshot remains the history source. Each durable receipt is stored in the original `idempotency` field under a domain-separated hashed key, so no new state-envelope field or integrity schema is introduced. Risk state, audit and receipt use one original lock/CAS save. Same-key/same-body retries replay; changed requests conflict. HTTP authorization is rechecked on every replay.

Native UI has its own reason/reference fields, preview, cancel and explicit confirmation. Preview/cancel makes no write. Durable pending risk intents are native-owner separated; UNKNOWN is not discarded or automatically retried. Refresh precedes explicit exact retry. Standard Wallet remains independent of private service failure. Twelve supported UI languages describe the native boundary. Old browser-local risk controls keep their original scope and are not relabelled as native protection.

## Regression corrections

Actual Go workspace browser tests enter `/app`, while standalone HTML fixtures continue to use their existing `/` route. Controlled snapshots receive their new exact Content-Length when rewritten; runtime byte/UTF8/duplicate-key checks remain strict. Experiment history now has the actual 17-column shape and explicit read-result action. Silent journal-removal failure remains fail-closed and is not expected to display success. Logo QA binds Exchange's current 23px contained logo without changing another product's source.

## Verification and release boundary

Focused checks cover native scope rejection, independent owner isolation, same-key concurrency, durable restart/replay, changed-body conflict, failed save, checked reconciliation arithmetic, preview/cancel, storage failure, retired-owner-before-dispatch and UNKNOWN exact retry. Real local Chrome exercises the accepted SDK kernel with controlled approvals and responses; it is not a real installed Wallet or public engine proof.

Final source/test totals and binary/archive SHA are recorded separately after freezing the exact source checkpoint. Only owned Quant paths and its dedicated backend are changed; shared SDK/Auth/registry/Host source is not written. The previous `8cb0e75e` archive must not be used as the final runtime because it omitted later product fixes.

Remaining release work: A must compose/review against its accepted shared producer and publish through the formal Host authority, preserving the existing UNKNOWN upload state. No blind SSH/upload/retry, real account grant, signature, EIP-712 or transaction was performed here. Public/installed/provider-approval/Product Session acceptance/Testnet execution/product-complete gates remain false until direct evidence exists.
