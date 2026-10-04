# Compatible Card Guest history increment

Prior handoff: receipt 1a036e16928eec79520d918fe684cd8065f4839e / product ceb9e02c650a9ef3b3c8faff6048e3f3c830a340. Branch remains codex/card-test-service-recovery-20261002.

This independent owned UX change makes older anonymous DEMO records reachable. Guest Activity previously rendered only the newest five events even when the preceding durable journal retained more. It now shows an explicit displayed/total DEMO count and an accessible 48px Show more action in the current locale. Each click reveals up to five more records without rewriting storage, navigating away, requesting Wallet access or implying a real statement.

Controlled renderer verification restores twelve valid events, displays 5 then 10 then all 12, and checks the exact original stored bytes remain unchanged and no Wallet callback is called. Count/action copy covers all twelve locales. This is anonymous local demonstration history, not private account/chain history, accepted Card authorizations or money movement.

Full batch: npm test 296 + 39 + 30 + 11 = 376 passed; separate server tests 118 passed; total 494 passed, no failures/skips. Frontend and separate server typecheck passed. Logs are preserved under evidence/20261003-testnet-operations/card-guest-activity-*.

No formal build/deploy or tuple/scope change. Do not interrupt/restart an existing formal release to pretend this increment is already included. Root and sole release owner A can admit the descendant source as a compatible successor, or first finish the already-running source-bound delivery and queue this change. The existing complete source-batch handoff and unproven public/native/approval/Card funding lifecycle gates remain applicable.

After its actual canonical delivery, verify restored history beyond five rows, keyboard and large-text/mobile access, correct locale and no record mutation on Show more. Source tests are not public completion. Existing page/account/unknown state and excluded Live/real Card/AICardAPI boundaries are preserved.
