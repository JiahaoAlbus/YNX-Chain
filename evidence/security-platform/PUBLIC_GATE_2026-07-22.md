# Public Gate Evidence — 2026-07-22

- Observed at: 2026-07-22 14:19:58 UTC
- Command: `YNX_FETCH_TIMEOUT_SEC=5 ./scripts/public_security_gate.sh`
- Result: FAIL
- Passed: 12
- Warned: 7
- Failed: 47
- Environment: public YNX testnet endpoints

The RPC, EVM RPC, faucet, indexer, Web4, bridge, and most AI checks did not provide passing evidence. The AI health endpoint responded, but chat endpoints returned 404, trade action calls returned 405 or timed out, on-chain settlement was not ready, and no bridge route readiness was observed. Website and explorer headers could not be fully verified.

This run directly contradicts `deployedPublic=true`. It does not invalidate local implementation or local tests. Raw responses are retained in the local generated-output directory and are intentionally excluded from release artifacts because they are operational captures rather than reviewed public documentation.
