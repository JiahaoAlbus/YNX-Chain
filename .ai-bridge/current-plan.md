# YNX Mail Current Plan

Product: 25｜YNX Mail  
Branch: `codex/final-mail`  
Stage: INTEGRATE  
Goal: Active

## Protected checkpoint

Runtime commit `02352ff97e4c5de1ba115b18c41bc740ba7e7191` is pushed and matches the remote branch. It adds the fail-closed Internet Provider Bridge, signed webhook handling, persistent replay protection, truthful delivery states, retry idempotency, recipient-hash suppression, bounded dead-letter recovery and local provider health evidence.

## Next autonomous slice

1. Add backup/restore and rollback compatibility tests for provider events, suppressions, dead letters and health state.
2. Emit private-minimized canonical delivery events for future Data Fabric integration.
3. Define active provider health polling without treating a successful probe as delivery readiness.
4. Define a centrally authorized operator review/unsuppression path with Trust and Monitor owners.
5. Rebuild and reinstall current-source desktop, Android and iOS artifacts.

## External gates retained

Provider account, credential reference, verified domain, DNS, public webhook, terms approval, abuse operations and current-source hosted artifacts remain false and must not be inferred from local code.
