# Quant ordinary research lost-return recovery — 2026-10-03

Status: owner source and controlled local runtime verification. Not a public release, installed build, Wallet approval, Product Session, real market or capital-execution proof.

Predecessor: `acbdee7808eb9dfaf8d126d9a0fc628163a03df9` on `codex/exchange-sso-cookie-binding-20261002`. Scope is Quant ordinary research API/persistence/client/tests only. No Wallet SDK, Auth grant, final served graph, release pins, public host, DEX or Pay changes.

## Implemented behavior

- A saved research submission persists one exact original request before POST. Lost/invalid/timeout outcomes retain it across reload, locale changes and service restart. Explicit retry uses identical inputs/key; changed inputs cannot silently create another experiment.
- Optional `idempotencyKey` on the existing local saved `POST /v1/backtests/from-market` accepts `quant-research-<UUID>`. A normalized whole-request digest and key are stored in the existing experiment record. Existing durable lock/reload/atomic persistence checks both before market read and before commit. Same tenant/key/body returns the original receipt; a changed body conflicts. A restart can replay without market connectivity.
- `researchRequestKey` and `researchRequestDigest` are optional `omitempty` response/state fields. Existing unkeyed callers and old state remain compatible. Existing audit digest includes correlation for new records. No engine mathematics, schedule authority or trading permission changes.
- The browser checks returned request correlation plus existing exact strategy/assumption/result fences before acknowledging. Invalid persisted drafts are preserved, not silently replaced. Local forgetting requires confirmation and explicitly does not cancel/delete server research.
- Product API fetch and body parsing have a 30-second cancellation deadline, JSON MIME and 8 MiB response checks, no-store/same-origin/no redirect, no automatic write retry. Buffered body size checking is not a streaming memory bound. Transport failure cannot fabricate completion. Recovery messages cover all 12 existing languages.
- The existing public stateless research endpoint remains stateless; existing local-preview peer/forwarded-header restrictions remain unchanged. Browser Paper tenant capability remains separate from Wallet identity. This is not a new public saved-workspace authority.

## Executed checks

1. `node --check apps/quant-lab/web/app.js`: PASS.
2. `go test -race ./internal/quantlab -count=1`: PASS, 2.624 s. Includes persisted replay, two instances/12 concurrent same-key requests producing one experiment, changed-body rejection, restart without market, receipt-copy isolation and tenant separation. Environment-gated PostgreSQL tests are not a PostgreSQL/public deployment claim.
3. `node --test apps/quant-lab/tests/business-flow.test.mjs apps/quant-lab/tests/research-recovery-browser.test.mjs`: 51/51 PASS, zero skipped, 4505.634125 ms.
4. `node --test apps/quant-lab/tests/browser.test.mjs apps/quant-lab/tests/tenant-persistence.test.mjs`: 20/20 PASS, zero skipped, 46538.727416 ms. Includes real local HTTP/two tenants/two processes/12 same-key Paper submissions and restart isolation with controlled synthetic data, not real financial execution.
5. `git diff --check`: PASS.
6. `go vet ./internal/quantlab ./apps/quant-lab/server` and new browser-test syntax: PASS.

The new browser regression runs the actual locally built Go server, controlled synthetic matching-tape-shaped data, and actual Chromium at mobile width. First POST actually persists a result, then its return is deliberately lost. Changed inputs make no second POST. The actual server is stopped/restarted with the same state, the browser reloads, Arabic is selected, and explicit retry returns the byte-identical original receipt. One experiment/strategy, two user-initiated POST attempts, one tab, no page errors or horizontal overflow; second reload retains history. This does not represent real public market fills.

## Central integration / publication

Adopt backend and browser delta together. The new browser uses an optional request field that old strict backend decoding will reject; do not publish it against an old backend. The final served graph/pins and formal runtime publication belong to the unique release owner. This commit intentionally does not regenerate shared wallet bundles or overwrite release graph metadata. Public/source identity, installed cold/second start, real Provider approval/callback/refresh/disconnect and Product Session gates remain unproven.

Rollback: revert this single owned source commit through normal Git history and release the prior complete backend/browser graph together; never delete tenant research state. Newly added optional persisted fields are retained as data. Do not retry unknown financial operations or treat research replay as capital execution authorization.

Remaining shared integration issue, distinct from this ordinary research change: Exchange v2 read authority currently grants only `exchange:read`; security/support/AI write routes need the accepted shared business-action verifier/actor/object/idempotency contract, not promotion of a read proof into write authority. This issue is reported to `接续测试网生态审计工作`, not the former audit conversation.
