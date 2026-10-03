# Quant daily-risk visible integrity and public release gap

Parent: 02a959cdfb96a72c4a315fc9b40c44b776568298. Ordinary product UI/tests only. No shared Wallet/authority, formal release pins or Host mutation.

Daily-risk rendering now rejects impossible calendar dates and a reported loss at/above the limit paired with Breached=false. Legitimate leap-day receipts and Breached=true with recovered loss below threshold remain readable (the backend latches a daily breach). Unknown records display the existing unavailable marker rather than a fabricated armed/active status.

Executed gates:

- node --check apps/quant-lab/web/app.js and git diff --check PASS.
- business-flow.test.mjs: 93/93 PASS, 626.152708ms; includes impossible dates, contradictory threshold, valid leap day and latch recovery.
- browser.test.mjs with test-name-pattern=daily: actual local Chrome 2/2 PASS, 3579.119041ms. Controlled responses, mobile390, Arabic transition, no write requests, no overflow/page errors, one tab. Not public wallet acceptance.
- research-recovery-browser.test.mjs: actual local Go/two browser profiles 1/1 PASS, 10151.079792ms, three clean SIGTERM stops. Retained /var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-research-recovery-LcHSYX. Test binary 11467138B SHA256 38b3cfd3d99fb4a18e541ff5ae8faa337db88c6ed9d25bcb295a44a9a4a3517b.
- An initial mismatched filter Paper.*daily selected no intended browser cases and left a pending file-level promise. Interrupted after79747ms; cancelled, NOT PASS. Correct daily filter above executed both actual cases.

## Direct public GET readback (2026-10-03T18:50:33Z)

- https://quant.ynxweb4.com/api/version: HTTP200,274B,SHA256 f82629a1bd63e50f6721611cbf7866f86d7bffd51820b05a417590541c4653df. commit664b80b00ac576317524f25b49fc01d1c0db7196,version0.2.0-testnet,filesystem_json_snapshot,multiInstance=false.
- https://quant.ynxweb4.com/api/ready: HTTP503,283B,SHA2564592a6896439bfde9243868675ccb91625e3701a2389a895e2d693de36520655. Reason: multi-instance durable PostgreSQL state is required for a deployable Quant service.
- Bare /version and /ready returned404; canonical API-prefixed routes above are the actual runtime contract. No mutation or account request.

Release owner must integrate exact ordinary source and provide deployable database readiness. publicCurrentSource=false; installedVerified=false; walletApproval=false; realOrders=false; migratedV2=false. This checkpoint does not repair Host or claim public multi-instance acceptance.
