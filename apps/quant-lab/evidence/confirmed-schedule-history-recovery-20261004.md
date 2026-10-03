# Quant confirmed schedule and unavailable history recovery

Predecessor: `0b4d4166efc4d35460d922c567791fcc5f659869`.
Branch: `codex/exchange-sso-cookie-binding-20261002`.

Reproduced defect: an exact accepted schedule start/stop receipt updated the
saved strategy, but failure of the subsequent snapshot read entered the same
catch branch as an unknown write. It incorrectly inserted the strategy into
`scheduleUnconfirmed`, hiding a confirmed scheduled/stopped state. New direct
production-controller regression failed before the fix (71.750 ms, 1 != 0).

The product controller now records confirmation only after all existing
ID/hash/stage/runtime/assumptions checks and exact saved-strategy binding pass.
A later read error retains that confirmed receipt and reports localized stale
workspace read status. Unknown or mismatched write receipts still enter the
unconfirmed fence. No endpoint, execution permission or backend logic changed.

Installed Chrome mobile 390x844 journey directly executes the product page:

- controlled exact start receipt followed by HTTP 503 history read;
- confirmed queued state remains, explicit stop remains available;
- twelve languages retain read-failure versus write-confirmation distinction;
- controlled exact stop receipt followed by failed history read;
- stopped state remains and a new start is disabled while data is stale;
- explicit Refresh, then page reload reads the stopped record again;
- exactly two controlled PUTs (start, stop), no extra tabs or page errors.

These schedule endpoint/readback fixtures do not prove a real scheduler ran.
Previous independent real-engine/PostgreSQL crash evidence remains separate.
No account approval, signing or Testnet transaction is claimed.

Final complete ordinary product regression:

`node --test apps/quant-lab/tests/business-flow.test.mjs apps/quant-lab/tests/browser.test.mjs`

**138/138 passed**, zero skips/failures, 60948.320 ms. Covers saved/public
research mode, exact request recovery, strategy reuse, source metrics/costs,
schedule confirmations and failures, reload, stream parsing, history, risk lanes,
Kill/Paper admission and persisted local-service risk recovery. This includes
controlled local Go-backed journeys, not public financial usage or PostgreSQL
proof for this UI-only change. No unchanged backend/PG tests were rerun.

`node --check apps/quant-lab/web/app.js` and `git diff --check`: passed.
No shared Wallet/Auth/SDK, authority, formal release pins, Host/build/install or
production mutation. Source-bound public deployment, real Wallet/PS lifecycle,
native install and ComputerControl remain unproven and owned by the release
integration queue; this is not product completion.
