# Confirmed research survives subsequent history outage

Base: 7358064672fc4ffb4742511afa37bee3fbc41708. Direct browser regression only; business code unchanged.

Executed the existing actual-Go/two-browser research recovery journey with an additional controlled 503 after the second browser's real successful research POST. The confirmed result remained visible, pending intent and durable pending key were cleared, and explicit history recovery issued no additional research POST. The two browser workspaces still read only their own persisted results after process restart. Existing lost-return exact retry, Paper/risk recovery, reload and three clean SIGTERM shutdown checks remained included.

`node --check apps/quant-lab/tests/research-recovery-browser.test.mjs`: PASS.
`node --test apps/quant-lab/tests/research-recovery-browser.test.mjs`: 1/1 PASS, 11079.668291ms; journey 10830.622583ms.
Local Go binary 11467138 bytes, SHA256 07aed14299471a09c4668816486d6bc902dfa50d7b8a744051f2a31c46472631. Retained local test artifacts: /var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-research-recovery-3ToVSL.
`git diff --check`: PASS.

Installed Chrome used headlessly with two isolated browser contexts and controlled local tape. This is not ComputerControl, authenticated Wallet users, verified public market data, public/current-source deployment, native installation, approval, signature, transaction or Product Session v2 evidence. Those release/acceptance gates remain unverified and assigned to the existing release owner.
