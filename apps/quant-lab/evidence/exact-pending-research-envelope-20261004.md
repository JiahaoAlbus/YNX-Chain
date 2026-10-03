# Exact pending research envelope recovery

Base cebf94420a45ad63630b5fe57b1b457223db1415. Ordinary Quant product scope; no shared protocol, permissions, engine, endpoint, release pin or Host changes.

Found a recovery discrepancy: Paper rejects rewritten persisted JSON envelopes, while research accepted duplicate keys after JSON.parse silently normalized them. A direct regression failed (`pendingResearchInvalid` false versus true, 17.00625ms). Added exact JSON.stringify round-trip comparison for research's self-produced pending envelopes. This is not an imported-JSON API policy or an authentication boundary. It rejects duplicate financial/strategy fields and rewritten formatting, preserves raw pending bytes for explicit local recovery, and does not silently create another run.

Validation:

- Direct regression covers duplicate fee and strategy fields plus rewritten whitespace through twelve locales, retaining bytes with zero POST/proof calls.
- Full business/browser/real-Go recovery groups: 140/140 PASS, 61291.708084ms. Existing exact lost-return retry, cost binding, tenant isolation, restart, Paper/risk and schedule behavior included.
- Added actual installed Chrome regression: legitimate unknown outcome creates pending intent; altered bytes are persisted; reload and twelve language selections refuse replay, retain the exact bytes and keep one tab with zero page errors. 1/1 PASS, 4834.409375ms. Exactly one POST for the original attempt, none for rewritten requests.
- Node syntax and git diff checks PASS.

Local controlled service/history/browser tests only. No public/current-source release, native installation, ComputerControl, authenticated Wallet approval, signing, transaction or Product Session proof. Formal release remains assigned to the existing release owner; no production mutation performed.
