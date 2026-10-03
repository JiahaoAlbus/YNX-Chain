# Quant financial JSON ambiguity fence

Inherited branch `codex/exchange-sso-cookie-binding-20261002`, parent `534413828a4807c140efed4b8998c84660d3aa12`.

## Reproduced and corrected

The newly added HTTP regression failed before the source fix: a document with repeated Paper Cash fields was accepted by plain JSON.parse, which silently selected the last value. The Quant product HTTP reader now scans JSON before materializing it, rejecting duplicate object keys (including escaped aliases), nesting deeper than 64 and invalid/trailing structure. The existing streamed 8 MiB bound and deadline remain unchanged. Valid additive fields, separate objects with the same field names, Unicode, escaped strings and signed values remain readable.

Tests cover ambiguous Cash, statefulPreview, ReturnBPS and IdempotencyKey values plus excessive array depth. A refused POST response is unconfirmed; no automatic request replay occurs. Existing product recovery continues retaining the exact pending intent rather than claiming success.

## Executed results

- Business-flow tests: 95/95 PASS, including duplicate/escaped-alias/depth negatives and valid-document acceptance.
- Actual local Chrome duplicate-key workspace refresh: 1/1 PASS, 1.594 seconds. The failed read retains previously verified Cash=777, marks workspace read unavailable and blocks fresh Paper submissions; a subsequent valid refresh clears the warning. Three reads, zero POST, one tab and no page errors. Controlled response fixture, not public account evidence.
- The first browser fixture run failed because it awaited the intentionally rejected refresh without asserting the expected rejection. The fixture was corrected to assert that rejection explicitly; the product rejection was retained.
- Actual Go engine, controlled local tape and two independent Chrome contexts: 1/1 PASS, 15.130 seconds. Lost-response retry, persisted research isolation and service restart checks remain valid; three clean SIGTERM stops. Retained QA root `/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-research-recovery-wjlOgH`; test binary 11467138 bytes, SHA256 `38b3cfd3d99fb4a18e541ff5ae8faa337db88c6ed9d25bcb295a44a9a4a3517b`.
- `npm test --prefix apps/quant-lab`: 104 PASS, 1 FAIL. The protected final release graph still rejects `QUANT_ASSET_HASH_MISMATCH:styles.css`. It was not changed or bypassed.
- Node syntax and `git diff --check`: PASS.

## Remaining release truth

No shared Wallet protocol, engine rules, permissions, Host, release pins, installed package or public runtime was modified. Published source-bound runtime, actual provider approval, Product Session lifecycle and real Testnet execution remain unverified. Release owner must bind final source assets and publish through existing authority; controlled local tape/browser evidence cannot promote public gates.
