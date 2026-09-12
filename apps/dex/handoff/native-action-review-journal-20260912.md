# DEX native review journal — local candidate, not a swap completion

Owner branch: `codex/dex-wallet-restore-choice-20260912`.
Implementation: `d3ee80647ca85e59e81aa351a11d41b28cd4d8bd`.
Tree: `d274abdaa36f6c45e39d7b243cc7aa4c86c32e71`.
Report present and future issues only to continuation audit task
`01a094cc-0ba3-7901-bcd5-56fce8330c0d`.

## Actual implementation

- Explicit swap/liquidity review now saves a real, durable, SDK-validated request rather than implying Wallet was opened. Before saving, reread the authoritative account snapshot and compare the reviewed pool/reserves/assets/fee/block anchor. No rounding of unsafe nonce or amount integers.
- Consume Wallet source `ff5b7d49dd515d31d567c352dd049ac7b79d4139`, tree `92bc40205167e80edcf10a31ff83db0fab592d08`, exact browser artifact 110477 bytes SHA256 `627d7c57e15bfc3a92c77fb58d11c2bdb0e54f8f20c5989d51091163b71f5d0f`, 23 inputs / zero external imports. Registry and artifact manifests are byte-exact vendor inputs, not a second protocol.
- Strict IndexedDB read/write transactions commit before any URL can be returned. Each native account has at most one unresolved intent across tabs. No in-memory fallback, legacy storage reads, private key or device secret.
- Cold restoration preserves exact original request ID/state/nonce/expiry. Expired requests cannot relaunch; only an explicit digest-bound discard can remove unsigned intent. Signed bytes/hash must remain for receipt lookup, never replaced after an uncertain response.
- SDK callback parsing verifies actual Core signature, account/action/payload/nonce and exact registered callback/request correlation. Exact duplicates are idempotent; conflicting callbacks fail closed. This parser is available to the product but automatic callback submission remains disabled.
- Visible saved-request panel lists exact request fields, nonce, expiry, snapshot/digest, amounts/minima, and network fee **1 whole YNXT**, separately from pool fees and EVM wei. Restore, refresh, unsigned discard and official download are real controls. New labels/errors have all 12 existing locales. Account changes hide older details and cancel outstanding UI work independently of the Standard revocation flow.
- Standard connection / private session / native signing remain separate. No provider call, account permission, signature, Wallet launch, POST or transaction is performed by saving/restoring a review.

## Explicit remaining launch boundary

Wallet owner confirmed this turn that no accepted Web application-action launcher or verifiable installed handler/version capability proof has been delivered. Native14/15 source/install evidence does not provide a Web-readable attestation. Therefore the UI has **no native launch, sign or submit button** and explains the gap; it exposes the official download only. Do not wire `walletURL()` to an implicit scheme/iframe/window.open, and do not use Standard provider presence as native capability evidence. Integration waits for the unique Wallet-owner launcher contract, not a product clone.

DEX public tool access was separately denied. No alternate browser, curl, SSH or endpoint was used to bypass that refusal. This candidate has not been publicly deployed, installed or approved. Core owner reports newer `d4857f24735cccc23f2034c110f966ad99273e2f` preserves the native snapshot schema; `not_found` while checkpoint access is busy still requires GET of the same hash, never a fresh signature/ID.

## Tests actually run

- `npm test`: **162/162 PASS**, 16 files. Includes 12 native journal cases and 15 panel/12-locale cases. Synthetic fixed test key/signatures and provider doubles are explicitly test-only, not public Wallet approval.
- `npm run build`: TypeScript and Vite PASS, new SDK is included through the actual review UI.
- `npm run verify:canonical-authorize`, `verify:legacy-route-quarantine`, `verify:native-action-journal`: PASS. The canonical scanner exempts only one exact registry-validator error string after verifying the entire fixed native SDK SHA; it still scans all other code for forbidden launch behavior.
- `npm run test:native-action-storage`: actual local headless Chrome PASS. Real IDB in 2 tabs executes 24 competing updates, abort retains prior bytes, a second browser process restores exact data, explicit delete works, legacy sentinels unchanged. All external network requests blocked, observed count 0. Local origin cannot impersonate the canonical product. This is not ComputerControl/public/installed-wallet evidence.
- Independent gzip/tar readback: all 10 files match inventory path/bytes/SHA, no extra/duplicate/non-file entry. JSON and `git diff --check` PASS.
- An intermediate jsdom/Node byte-realm fixture incompatibility was corrected by running protocol unit tests in Node; real-browser storage was tested separately. An intermediate draft cancellation fence interfered with revoke acknowledgement; it was corrected to use a separate native intent revision and full Standard revoke regression now passes.

## Immutable local Web artifact

Directory: `/Users/huangjiahao/Desktop/YNX Project Audit 2026-09-06/coordination-01a094cc/dex-native-review-d3ee80647-20260912`.

| File | Bytes | SHA256 |
| --- | ---: | --- |
| ynx-dex-web-pwa-0.1.0-testnet-preview.1.tar.gz | 733764 | e6f18eafd15704c8a1d10b9f459d6efbffa7921e79247434102a02e24f1d2ed2 |
| web-pwa-artifact.json | 2533 | 6e8e3b421f73c52d09204faf5814aa430385f217e5b62ee667aadb7cd2a9c72a |

This is a Web upload archive, **not DMG, EXE/MSIX or APK**, not a public download. Earlier source-bound server reader candidate remains separately frozen in `apps/dex/evidence/native-read-runtime-candidate-20260912.json`; no server was rebuilt or deployed in this UI slice.

## Rollback and truth

No remote mutation needs rollback. Preserve published branch history. To revert this local UI slice later, review a normal revert of implementation `d3ee80647...`; never reset/clean other owners. Do not auto-delete the native journal or any signed intent when switching source versions. Any future service deployment needs a fresh actual target/state/rollback check and resolution of the specific public access refusal.

Public deployment, download hosting, installed Wallet capability, real account approval, callback from a real device, signature, swap, liquidity, production signing and mainnet are all **false** for this checkpoint.
