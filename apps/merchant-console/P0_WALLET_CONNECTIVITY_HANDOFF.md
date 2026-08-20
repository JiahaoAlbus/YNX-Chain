# P0 Merchant Console wallet connectivity handoff

- Campaign: `P0-WALLET-CONNECTIVITY-2026-08`
- Task: `P0-052`
- Branch: `codex/p0-merchant-console-wallet-connectivity-20260821`
- Implementation: `a59974d52b8c4fadaf1cd34db624f94b377f7cc5`
- Scope: `apps/merchant-console/**` only

The existing console previously exposed only a legacy private Product Session flow. This checkpoint adds a real Standard Wallet consumer through the accepted DApp Connect SDK modules: EIP-6963 discovery, EIP-1193 account access, YNX Wallet preference, standard-wallet fallback, YNX Testnet add/switch, and account/chain event handling.

Standard Wallet is independent from the private merchant service. The accepted Endpoint Manifest declares App Gateway `UNAVAILABLE` and Pay product API `PENDING`, so the private action is disabled and visibly degraded while Connect Wallet and the no-login public capability preview remain available. No local or canned private Session, merchant record, balance or transaction is fabricated.

Evidence:

- Node tests: 13/13
- Browser build: pass; no Node-only dependency retained
- Release config scan: no loopback, emulator, HTTP production or example endpoint
- Local Browser: English UI, guest preview, private degradation, disabled private action, zero console errors
- Actual provider approval, Product Session v2, installed client, public deployment and Computer Control: false

The older worktree `/Users/huangjiahao/Desktop/YNX Final Worktrees/05-merchant-console` on `codex/merchant-data-lifecycle-v5` was not modified.
