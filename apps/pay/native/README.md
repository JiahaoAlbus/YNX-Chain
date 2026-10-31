# Native Pay business QA entry

This is a standalone Node native-service business client/module. It reuses Pay's original private HTTP service and Wallet Main's original review/journal; it is not a second signer, balance store or transaction state machine. It does not modify the frozen Expo/Web pages or claim a mobile GUI installer.

`node cli.mjs --help` and `--diagnose` run without Source or network. An explicit original runtime is required for business commands:

```sh
./ynx-pay-native --runtime /absolute/original-main-source-runtime.mjs invoice 0x... invoice-id
./ynx-pay-native --runtime /absolute/original-main-source-runtime.mjs terms-review npi_...
./ynx-pay-native --runtime /absolute/original-main-source-runtime.mjs pay-review 0x... invoice-id
./ynx-pay-native --runtime /absolute/original-main-source-runtime.mjs pay-submit 0x... invoice-id 0xORIGINAL_MAIN_ABCI_HASH
./ynx-pay-native --runtime /absolute/original-main-source-runtime.mjs refund-review 0x... invoice-id refund-id 30
./ynx-pay-native --runtime /absolute/original-main-source-runtime.mjs recover 0x... invoice-id 0xORIGINAL_NATIVE_HASH
```

The actual runtime module exports `openNativePayRuntime()` and returns:

- `current()`: original synchronous actor/account/session/epoch fence.
- `pay`: `createPrivateNativeInvoiceClient({origin, requestPrivate})` using the original qualified fixed-origin service transport. No fetch/TLS or service-credential fallback is included.
- `main`: the original protected Main facade exposing `requestPQTypedAction`, `reject`, `vault.status` and original `transactionSender.submissions.intentStore`. It may bridge the existing protected IPC but must not fabricate pending requests, store results or approval.
- `readInvoiceOriginals(subject,current)`: original Main/Source read-only archive. It returns exactly Main's existing `invoiceOriginals` shape: `{termsMessage,settlement}`. Refund `settlement` contains original `{review,member,original:{reviewSnapshot,signingSnapshot,selectedBinding}}`; no current nonce is decremented and no payer review/snapshot is invented from a Pay DTO. Missing archives close only that review.
- `withSubmissionApproval(originalReference, send)`: original Main/Auth's existing protected broadcast pipeline. It must reserve and durably mark the **same original Main journal** UNKNOWN before invoking `send()` once, under its actual approved capsule/current fence. It must target the Pay original-Member endpoint instead of also broadcasting to Core. It must never automatically retry, re-sign, clear UNKNOWN, or call `send` based on a boolean. Signing review is not broadcast consent. Missing this callee closes submission.
- optional `close()`: original owned resource cleanup.

Normal Main/SDK resolution for `@ynx-chain/wallet-auth` must come from that admitted original runtime/SDK image. The client consumes its sole codec and Main's existing invoiceOriginals review port. It does not copy or supply a new ABI/signer/provider. The actual approval remains in the existing Wallet UI/Auth; this CLI has no `approve`, key-import or raw-Member-paste command.

The workflow is intent → merchant review → original retained Member → original RegisterTerms → original terms recovery; payer invoice review → original Member → Pay settlement; merchant refund review → original payer-bound Member → refund; original hash query/reconcile after any uncertainty. Receipts are authenticated Pay projections, with `clientIndependentFinality:false`; the service's original H/H+1 verifier owns funds confirmation. Summaries omit full Member/envelope/policy material. Cold clients recover by server/Main references and create no new local transaction journal.

Build with `node scripts/build-qa.mjs /absolute/output`. It packages the exact Node executable and required libnode on macOS, three source modules, launcher, README and hashes. No actual Source/runtime, SDK admission image, credentials, private keys or demo is activated. The resulting `ynx-pay-native --diagnose` is runnable as shipped; business calls accurately remain unavailable without the original runtime. Other original Node host dynamic dependencies remain required and are recorded by the build. It is a QA client/module, not an installed/production payment claim.

The focused workflow test runs actual Pay private ctor/HTTP/Store with real independently verified temporary Core proofs, sole current SDK Member math and Main's actual invoice review caller. Approval handing-off and selected public accounts are explicitly QA fixtures; no Native custody or real user consent is asserted. It covers terms, payment100, refund30/net70/fees, response-loss UNKNOWN, cold Pay Store/client recovery without resend, and Source retirement. Source/test/build/install/deploy/real funds are separate.
