# Quant public source/assets gate

Owner continued from clean 8c6161dad8e08b91594b7d0c72d5d6b5e215f070. No remote write, SSH, upload, account, signing or transaction action.

The server mounts its version and health under `/api/`. Root `/version` and `/health` 404 do not establish outage.

Fresh direct GET observations on 2026-10-04:

| Public route | HTTP | Bytes | SHA256 |
| --- | --- | --- | --- |
| /api/version | 200 | 274 | f82629a1bd63e50f6721611cbf7866f86d7bffd51820b05a417590541c4653df |
| /api/health | 200 | 462 | 9f20f70d5719359683c2f2e4a0dabacd7003072d01b16e1930520ea79b01b4cb |
| / | 200 | 22457 | 216e54c8b2e79835bd52d4802d5c805ae864c6702b54db9508abae284c93ec32 |

Both JSON routes bind old commit `664b80b00ac576317524f25b49fc01d1c0db7196`, not candidate `b60c02ec03436e6d7d78d0fb65ca58d74d80a082` / tree `3228bd24ff2826fac853d9f560d2dced55a94e98`. Public health reports filesystem backend, multiInstance=false and ready=true; this is not evidence of the required multi-instance readiness.

Added executable read-only publication gate:

```sh
node apps/quant-lab/scripts/verify-public-runtime.mjs /tmp/ynx-quant-composed-b60c02ec0-linux-amd64.tar.gz b60c02ec03436e6d7d78d0fb65ca58d74d80a082
```

It reads the candidate manifest from the unchanged frozen archive (3938376 bytes, SHA256 `657d0334d2598304c3282fbcbd4bfbafadf4feea64dd6987be9053e85d000253`), validates exact source/tree, canonical complete asset inventory, then GETs exact JSON and every Web asset and checks status/bytes/SHA. Redirects, HTML fallbacks, duplicate/missing/traversal inventory, old source and inconsistent health fail closed. It never promotes approval/install/transaction flags. Actual public run exited 1 with `PUBLIC_SOURCE_MISMATCH:/api/version`, as expected, not a successful release.

Focused deterministic tests: 5/5 PASS (61.00425 ms). Fixtures are verifier regression only, not public or Wallet proof. Syntax and diff gates run separately. No backend/business source changed and no unchanged full suite claimed.

Executable delivery dependency: formal Host publisher A must compose/publish the exact matching candidate with compatible shared inputs and rollback, then run this public gate. The user-authorized routing chat was sent exact current source/candidate/public mismatch. UNKNOWN host transports are not retried by this owner. Real Wallet approval, public candidate, installed platforms, callback, signatures, transactions and aggregate completion remain unverified.
