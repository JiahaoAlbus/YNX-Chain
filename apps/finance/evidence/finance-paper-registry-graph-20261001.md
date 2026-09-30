# Accepted Paper registry: compatible Finance/Auth graph

Base 65428eb36f0d4496636f08af8cd4e2dca94b3555 is the clean main4f successor
containing only the accepted f624cc907ac891747ea7823f011604a0f2fbc746
fourteen-file Wallet/registry scope group. Those fourteen source files are
unchanged by this rebuild. Uncommitted Quant backend/consumer work in the
Finance owner's separate worktree is excluded.

Finance rebuild source 529cdcd493841a82f2244e34be1d7c430b39f47b (3 files),
then central generated bundle source 7c4f46ef43721bbdb9e7cc0e19314a3e4a4c0887
(1 generated file), tree 91ada62f935437996de026f7aea65caf25c3fadc.
No protocol source, signing bytes, schema or Finance permission changes.

All builds use esbuild0.25.9 and each was built independently twice:

| Artifact | Bytes | SHA256 |
| --- | ---: | --- |
| Finance Wallet (unchanged) | 211324 | fe50d473914ee5f56590865f270cd6d09b09e328a840ac40a362cfa81c638190 |
| Finance EVM read browser | 80122 | e5473d622a2e0ceb7e478b4f4d43ae53660f58349f6c87e755622abe9d6fbe24 |
| Finance EVM read Node authority | 136143 | 60040fafda645c8d764fdd07b3105dca93631a32f44444d3555f91783a255efc |
| Central browser | 1083941 | b2a6255bff66a00c0a2842c54e5e53c019a6dd73770ee9065da778948eef0a9b |

The registry input affects all three read/central artifacts. Retaining old
bytes or permitting input drift would be invalid. The original read and
central dependency graphs, including official SDK and QR paths, are retained.
Dependencies were installed from existing lockfiles in this exact source tree,
not built through another worktree's node_modules symlink.

New candidate `evm-read-runtime-verifier-candidate-paper-registry-7c4f46ef-20261001.json`
74031 bytes SHA256 b3f01f226651700b4a97c648f38eeb0bd2ca43ec2d13d0c60de4e29434362511.
Current manifest SHA256 1ed8a558f6e52da8af38f009ab31aedb080c4d940b63dc8be0921784eef4ac6d.
All previous immutable candidate files are preserved.

```sh
node apps/finance/scripts/build-guoqing-account-session-candidate.mjs 7c4f46ef43721bbdb9e7cc0e19314a3e4a4c0887 apps/finance/evidence/evm-read-runtime-verifier-candidate-paper-registry-7c4f46ef-20261001.json
node apps/finance/scripts/build-guoqing-transport-manifest.mjs ../evidence/evm-read-runtime-verifier-candidate-paper-registry-7c4f46ef-20261001.json b3f01f226651700b4a97c648f38eeb0bd2ca43ec2d13d0c60de4e29434362511
node --test apps/finance/tests/evm-read-verifier.test.mjs apps/finance/tests/wallet-bundle-verifier.test.mjs
node apps/finance/web/verify-wallet-connect.mjs
```

Actual final result 23/23 PASS, zero skipped (1.413s), direct verifier PASS.
Public/installed approval and owned-service lifecycle are not proven by this
source graph. Paper's independent scope still requires explicit Wallet review;
identity/records do not receive Paper authority. Quant public Paper remains
disabled until its separate backend/consumer and matched release gates pass.
Only the unique release owner integrates/pushes/deploys the compatible group.
