# Agent status

- Product: `05 | YNX Merchant Console`
- Stage: `FREEZE`
- Goal: `Active`
- Workspace/branch: exact match verified
- Runtime HEAD: `b0934a09df9d2dbea67abb596ad84154ab168312`
- Remote runtime HEAD: `b0934a09df9d2dbea67abb596ad84154ab168312`
- Runtime push: succeeded
- Runtime tests: `go test ./internal/payproduct/...` passed
- Runtime race tests: `go test -race ./internal/payproduct/...` passed
- Full repository gate: failed only in unrelated consensus/BFT/faucet/trust areas because of a missing bounded-IDE artifact and darwin permission-mode assertions; Merchant Console remained green
- Data rights: owner-only schema-v1 export and audited request/cancel state machine tested locally; irreversible execution remains intentionally unavailable pending accepted policy/operator authority
- Snapshot: v3; v1 and v2 migration tested, future versions rejected
- Evidence checkpoint: dirty and under review; not yet committed/pushed
- Central integration: false
- Testnet/staging/public/hosted/signed/store release: false
- Immediate action: validate JSON, review evidence diff, commit/push, verify Local SHA = Remote SHA, then continue the next autonomous runtime gap
