# Finance browser identity response recovery — 2026-10-03

Owner branch: `codex/exchange-sso-cookie-binding-20261002`.
Predecessor: `ae60515fc2cd7873ae600cdd3b37d273554f1f4e`, tree `0dc3f65afe79ef6dbe1b3218e811e7936b527cef`.
Scope: ordinary Finance page response handling and direct tests only. No shared Wallet/Auth/SDK/grant, backend authority, release pin, Host, or deployment changes.

## Implemented behavior

- The existing same-origin SSO response wrapper now settles within five seconds across both fetch and response-body parsing, even when a transport ignores AbortController. Timeout rejection is queued before abort for deterministic deadline classification.
- Responses must be JSON objects with JSON media type, valid bounded declared length when supplied, and at most 262144 UTF-8 bytes after buffering. This is not a streaming memory limit. HTML fallbacks, corrupt JSON, null and arrays fail closed.
- Preserve original method, CSRF header, request body and same-origin credentials. Use no-store and reject redirects. Typed JSON HTTP rejections still reach the existing authorization state machine.
- No automatic replay, authorization synthesis or permission change. An unconfirmed logout preserves its existing pending intent and unlocks the explicit retry. A late response cannot falsely revoke the session or disconnect Standard Wallet. Only the explicit retry's confirmed response invokes the existing disconnect behavior.

## Executed verification

`node --test --test-concurrency=1 apps/finance/tests/browser-identity-response-deadline.test.mjs apps/finance/tests/product-response-recovery.test.mjs apps/finance/tests/owned-save-browser.test.mjs`

Result: 24/24 PASS, zero failures/cancellations/skips, 40013.238708 ms. Tests include actual headless Chrome normal-button flows with controlled local responses, not public Wallet approval or real session revocation.

After ordering deadline rejection before abort, the new identity-response file was rerun independently: 11/11 PASS.

Earlier runs are not concealed: the new Chrome fixture initially omitted revealing its SSO-enabled parent and timed out; the fixture now models that boot state. An existing export Chrome regression also timed out on earlier runs, including an isolated run. Its explicit retry click now has a five-second failure bound and diagnostic marker; final isolated 5/5 and complete sequential 24/24 passed. This does not establish that earlier intermittent timing failures are impossible.

Node syntax checks and `git diff --check` pass. No server build or installed/public acceptance is claimed by this page-only change.

## Release handoff and remaining gates

The designated release owner must incorporate this page and tests into the coherent Finance release graph; this checkpoint does not change global registration or deployment identity. Route unresolved issues only to `接续测试网生态审计工作` (`01a094cc-0ba3-7901-bcd5-56fce8330c0d`).

Public source-bound release, real account approval/rejection, private Product Session lifecycle, installed/native flow, signing and transactions remain NOT_VERIFIED. Controlled test responses are not production session evidence. Quant PostgreSQL multi-instance integration remains separately blocked on a reachable disposable QA database; no production database testing is authorized.

Rollback: release owner can retain the existing public artifact; this source-only checkpoint has made no public changes. If incorporated later, restore the previously signed coherent release rather than mix page and shared-authority versions.
