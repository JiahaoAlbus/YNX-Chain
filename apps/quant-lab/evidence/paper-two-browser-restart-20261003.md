# Quant research → Paper → risk, two-browser restart verification

Source parent: `b8c035e9322a58be7f55b29f91043ee05cf5ff6f`.
Actual local Go server plus two independent Chrome profiles; controlled 48-fill
local market tape, not a claim of public or live market authenticity.

Extended the existing real-service recovery test, not a duplicated simulation
engine. Each normal browser creates its own existing local-preview tenant.
The first research return is lost deliberately, then the same durable request
is recovered after restart. The second browser has its own saved research.

The first browser explicitly chooses its saved strategy, reviews and confirms
the normal simulation preview, then submits 1,000,000 integer micro-units through
the actual Go Paper engine. The persisted order is bound to that strategy hash
and `authoritative_market_adapter`. The second browser remains without orders.
The first browser explicitly confirms its Paper kill switch. Another complete
service stop/start preserves its exact Paper state/order/kill latch; the second
browser's own exact Paper state remains unchanged. Choosing the strategy again
still cannot submit while the latch is active.

The first test attempt correctly stopped at the unselected-strategy UI gate;
the test was corrected to perform explicit selection, without bypassing it.
The final execution passed: 1/1, 11189.179958 ms; total 11355.886125 ms.
All three SIGTERM shutdowns drained normally (exit 0), both browser error lists
empty, one tab each, same research recovery key/request body, no extra research.

Command:

```sh
node --test apps/quant-lab/tests/research-recovery-browser.test.mjs
```

Retained local run:
`/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-research-recovery-4iU5v0`.
Built binary: 11,466,914 bytes, SHA-256
`de7d339c3cdbc349e194c3ef0b12c6bfc9e87959072ff0cdc1bccc6328df2363`.

Only ordinary test/evidence changed. No Wallet/Auth/SSO/grant/release authority
or public runtime changed. This is local filesystem-backed preview persistence,
separate from the independently verified PostgreSQL tests and separate from
production namespace/version-fenced integration. Paper funds are simulated;
no wallet account grant, signature, Exchange order or chain transaction occurred.
Public source-bound deployment and real authenticated-user acceptance remain
unproved, not promoted by these two local browser profiles.
