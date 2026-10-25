# Run 11 Whole alias fixture correction

Original remote CI: Run 39086161661 at c7758085b75761db4c39dd34ee490d78403e80bc. Failure: TestABCIWholeCandidateRollbackAndTransferOverflow, account_batch_test.go:280, invalid transfer address. Original committed test SHA256: 8fe0ba96348a572cfc2704692c515a0e9c13f2d40f07de4ccf0ead94775e2b39. The original is retained in that commit; the remote log is owned by Root.

The final alias fixture attempted to sign a transfer to the default named validator fee account. Transfer.Validate correctly accepts canonical native accounts only. That alias case failed during SigningBytes, before its execution assertion; it is not evidence of a production alias overflow RED. The preceding three overflow subtests remain unchanged.

This correction temporarily selects the fixture's existing canonical recipient as the application's fee recipient, restores the original with defer, then uses a real dual signed Whole. It checks combined amount+fee balance credit, sender debit/nonce, amount-only lot movement and detached caller state. A second assertion puts the alias balance at MaxInt64-2 and requires rejection of the combined three-unit credit with unchanged candidate. No production validator/address/codec logic changed.

Frozen write set (source-only, gofmt completed; no local Go compilation/tests, no stage/commit):

| Path | SHA256 |
|---|---|
| internal/consensus/account_batch_test.go | b71f52ea21b5181e846ec66c9ce849b2e1ff0f95d90c9b51d40b9ad5931c0b40 |

Root focused command: go test ./internal/consensus -run '^TestABCIWholeCandidateRollbackAndTransferOverflow$' -count=1; then the existing full consensus CI group. Only an actual subsequent CI result can establish PASS.
