# Finance Weekly v3 public release — 2026-09-19

The Finance-only Weekly v3 implementation is publicly deployed at `https://finance.ynxweb4.com/` from source `9912d29f82d5ceca689f07e20e944648a2be6de3` / tree `516866313345666ea1987f760aae3adc15464338`. The public `/version` response binds that exact implementation commit.

The rollback-first deployment ran once and succeeded without automatic rollback. Current points to `/opt/ynx/releases/finance/finance-weekly-v3-9912d29f-20260919T144000Z`; `ynx-finance.service` is active/running with PID `1674358` and `NRestarts=0`. State was absent before, while stopped, and after the switch. No state migration, import, clearing or restoration occurred. The systemd unit, Finance drop-in and Caddy hashes are unchanged.

The public root, health, ready, version, seven Web assets and guest-safe `/api/broker/status` all returned HTTP 200 with artifact-matching bytes and SHA-256. Real browser verification showed the English guest surface, separate YNX Wallet and MetaMask controls, stable one-page navigation, zero console errors/warnings, and the Broker Sandbox section explicitly disabled with unknown balances shown as unknown rather than zero.

No Alpaca credential keys or sandbox-write key exist in the effective Finance service environment. The deployed operator diagnostic ran in `activation-plan --local-read-only` mode with no network or state write; because both credentials and an existing state record are absent, it correctly returned `SANDBOX_WRITE_ACTIVATION_BLOCKED`. No provider read/write, Wallet approval, signature, securities order, chain transaction, live mode, mainnet action or native-install claim was made.

Rollback target remains `/opt/ynx/releases/finance/finance-sdk-7a1d2aba-20260912T104700Z-r2`. The exact previous environment is retained at `/opt/ynx/stage/finance/finance-weekly-v3-9912d29f-20260919T144000Z/rollback/finance.env`, SHA-256 `000ef2feed4a35b1b0f17cf9955433ea354e786bdd65a724f8204d0a1c66fd7a`. A future rollback must freshly verify current state and must never restore an older state snapshot.

Full immutable evidence is in `apps/finance/evidence/finance-weekly-v3-public-deployment-20260919.json`; the remote full deployment receipt is retained at `/opt/ynx/stage/finance/finance-weekly-v3-9912d29f-20260919T144000Z/deployment-receipt.json`, 15,922 bytes, SHA-256 `977112d02c5871e3655be573df70607c7bf342ec7c9630dc2b33b83a8be5f0db`.
