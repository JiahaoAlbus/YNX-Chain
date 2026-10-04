# Quant exact Testnet order acknowledgement

Source `d27f3c1bbc6c57b1d552f8b367e406dd6213b0b9`, tree
`af5e671ad687085155ea5f92be0e734250e67228`.

The previous submit handler accepted any successful HTTP document, displayed
submission success and cleared the signature. It now admits only the existing
Go TestnetOrder receipt bound to the exact reviewed mandate digest, market,
side, price, amount and idempotency key, with valid order ID, strategy hash,
authorization digest, timestamp, broker proof and accepted venue status.
Reserved/foreign/malformed receipts remain unknown; preview/signature is
retained. Broker proof and signatures never enter success messages.

Single-flight prevents concurrent submit clicks from creating another proof
or order request. Cancellation and failure release the busy control; exact
confirmed receipt alone clears the preview/signature. The localized success
message explicitly distinguishes accepted venue status from settlement or
chain-transfer proof. No backend/Wallet/shared protocol changed.

## Executed tests

`node --test apps/quant-lab/tests/business-flow.test.mjs apps/quant-lab/tests/order-risk-preview-browser.test.mjs apps/quant-lab/tests/research-recovery-browser.test.mjs`

115 pass, 0 fail, 0 skip, 22229.254625 ms.

New local VM cases run the shipped handler: malformed/foreign 201 receipts,
reservation status, missing proof/hash/ID/date, exact positive receipt,
double submit with deferred proof, retention vs clear and 12-language messages.
Positive receipts/proofs/signatures are controlled local fixture values, not
real authorization, network execution or deployment evidence.

Retained actual Chromium risk-preview gate sends no Wallet proof. Original Go
two-browser research/schedule suite passed with lost-response and full restart,
four clean SIGTERM stops, retained root
`/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-research-recovery-qJq8HS`.
The unchanged local QA Go binary is 11516786 B, SHA256
`59c960666ac41a254e27eb6d6a9d1626ff19450f181627a7ca4f737236dade9a`.
Quant-only diff and syntax checks passed.

## Source objects / remaining boundaries

app.js blob `990101b278a062fd9744d0cd4ae5fa72ae6b5c14`, SHA256
`32e677783bf75de90afaaded653535f873c313ffaa77abc51ece6b9645cec5c0`.
index.html blob `1483de4cb698a118ddba92db83e6dd80580a13b6`.
business-flow.test.mjs blob `0033992eab4d2a825d638cab7b32e7e384465742`.

Outcome recovery across reload and current source-bound public/installed
authority/venue execution still require separate evidence. This checkpoint
does not claim real approval, sign, order, transfer, Product Session or public
completion. A owns formal assembly/release. Exchange UI dirty changes and its
requested version-only app imports remain separate and were not staged here.
Report all gaps to 接续测试网生态审计工作.
