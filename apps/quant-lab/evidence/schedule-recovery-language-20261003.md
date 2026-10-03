# Quant scheduled research recovery language

Inherited ordinary owner baseline: `b186213bc31b3237bbe1faf71b1830d22d4aac39`, branch `codex/exchange-sso-cookie-binding-20261002`. Only Quant ordinary page and direct tests change; no shared Wallet/SDK, authority, Host, Finance, Exchange, DEX, Pay or deployment mutations.

## Reproduced defect and minimal correction

The scheduled-research catch displayed a one-time string without retaining a language key. Switching language after an unconfirmed PUT left a stale-language recovery instruction. A new regression failed before the fix: the generic unconfirmed-request text was not the current schedule recovery message.

The catch now keeps the existing unconfirmed schedule fence and uses the existing language catalog key. Before-send invalid configuration uses `scheduleInvalid`; a typed `invalid_research_parameters` service rejection preserves `researchInputInvalid`; other sent/unconfirmed outcomes use `scheduleUnknown`. Switching among all 12 existing languages rerenders the corresponding message. No automatic retry, schedule execution, Paper order or Testnet authorization was added. A fresh verified snapshot remains the existing recovery mechanism, not a client claim of execution.

## Actual local checks

- `node --test apps/quant-lab/tests/business-flow.test.mjs`: 71/71 PASS, 417.819583 ms, including before-send no-write, typed rejection, all-locales warning, one-write fence and unchanged proof count.
- Focused shipped-page Chrome tests in `browser.test.mjs`: 2/2 PASS, 4030.53925 ms. Real local Go service/page, explicitly intercepted schedule records and aborted schedule PUT. Success receipt/pending rerender/confirmed stop plus unconfirmed-language recovery, twelve locale options, disabled retry until explicit fresh read, one intercepted PUT, one tab, page errors zero. Dialog approval is a fixture action only, not real account authority or public strategy execution.
- `node --test apps/quant-lab/tests/research-recovery-browser.test.mjs`: 1/1 PASS, 9062.2095 ms. Actual local Go research engine with explicitly controlled 48-trade tape, two independent browser contexts, lost-return exact-key recovery, persisted records across restart, two clean SIGTERM stops. Retained root `/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-research-recovery-Wum7dZ`; local binary 11466914 bytes, SHA256 `de7d339c3cdbc349e194c3ef0b12c6bfc9e87959072ff0cdc1bccc6328df2363`. Not public market, authenticated multiuser production/database or installer proof.
- Fresh uncached `go test -count=1 -race ./internal/quantlab`: PASS, 3.072 s. An earlier cached invocation is not counted as the fresh result.
- App/test JavaScript syntax and `git diff --check`: PASS.

## Visible evidence

Real local Chrome screenshots, not ComputerControl/public acceptance:

- `tmp/quant-lab-evidence/schedule-unconfirmed-en.png`, SHA256 `b2845136f812ee2404c4673b315375da8934c21889f3564857d0efd17cadf3ad`.
- `tmp/quant-lab-evidence/schedule-unconfirmed-ar.png`, SHA256 `0da289e83ff64570f28f02b462ea2840697ba22f8f00d82a10fb62bac473d6b8`.

Arabic screenshot inspected: recovery warning is Arabic, while pre-existing lifecycle prose and some table labels remain English. Do not claim all page prose is fully localized from this narrow dynamic-error fix. Temporary screenshots and QA roots are preserved locally, not downloadable installers or remotely hosted artifacts.

## Delivery boundaries

Public runtime/source binding, real Wallet approve/reject/sign/Testnet send, Product Session, public PostgreSQL multi-instance service and installed packages remain unverified. Current coherent publication belongs to the integration/release owner. Integrate ordinary source hunks/tests into its current graph rather than replacing this inherited checkout or historical pins. Rollback is a normal successor revert of this display-only correction; no data or production state was modified.
