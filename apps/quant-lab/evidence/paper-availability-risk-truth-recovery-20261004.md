# Paper availability and risk truth

Inherited clean source: 22046a828e28d6e492e2f36628138edc26583e00. Ordinary Quant UI only; no engine, shared authority, endpoint or formal release changes.

Two focused red regressions proved an actual misleading display: failed workspace read and unconfirmed risk response showed `Kill switch active` even when the last confirmed Paper KillSwitch was false (15.467833ms and 2.28375ms). The old renderer used that label for every fresh-intent blocker.

The same existing blocker key now drives both the submit fence and the displayed reason, updated whenever the control is rendered. It distinguishes workspace read unavailable, risk receipt unconfirmed, unreadable pending Paper intent, and actual active kill. A successful explicit refresh clears the warning without replaying research or Paper orders. Exact unknown Paper intent recovery semantics are unchanged.

VM regressions cover twelve locales, actual failed refresh and recovery, risk lane/unconfirmed result/unreadable request/confirmed kill, no fabricated kill state, no write or proof call. Actual Chrome with the actual local Go service additionally verifies the failed history read in twelve languages, disabled Paper submission, confirmed KillSwitch=false, explicit refresh with no resubmit, restored label, and a later genuinely confirmed local simulation kill showing the correct active label. Two browser profiles, saved research isolation, lost-return exact replay, measured short-loss curve, and four SIGTERM/restart cycles remain exercised.

Four ordinary test groups: 112/112 PASS, zero failures/skips, 19283.890417ms. Final screenshot-extended actual Go/Chrome test: 1/1 PASS, 15746.550958ms. JS syntax and git diff checks PASS.

Retained local QA root: /var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-research-recovery-paZd9e

- Local QA binary: 11467138 bytes, SHA256 d342ef34c43da678ae5202dea0d5a2801448821b684e539cf27af0cded36f2e8. Unchanged engine; this is not a release installer.
- workspace-unavailable-en.png: 208240 bytes, SHA256 5ee1554910fa77770178e620671314368a51d3896158c68cd356e05583d3a28f.
- workspace-recovered-en.png: 191611 bytes, SHA256 6cbeaa193067e3345297f36252bf338217907884f80b6c623955edff54e1629e.

Both screenshots were visually inspected: unavailable and recovered states preserve the Paper simulation/fee boundaries and the non-active `Armed` risk receipt. These are controlled loopback Playwright/Chrome screenshots, not Mac ComputerControl, public current-source proof, installed-app evidence, real Wallet approval, Product Session v2 execution, or testnet capital execution. Formal compatible publication remains with the sole A release owner.
