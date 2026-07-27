# YNX Browser agent status

Updated: 2026-07-27

## Current state

- Product: 22 · YNX Browser
- Worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/22-browser`
- Branch: `codex/final-browser`
- Goal: Active
- Phase: FREEZE
- Built source commit: `88bf8dddf06411ea26749abdd5ea52173b7cd10a`
- Remote branch SHA before this evidence update: `88bf8dddf06411ea26749abdd5ea52173b7cd10a`
- Dirty state: macOS evidence and release-state updates pending commit

## Verified

- Browser Node tests: 14/14 pass
- Browser Smoke: pass
- Wallet/permission contract tests: 15/15 pass
- macOS Swift 6.1 arm64 release build: pass, 41.70 seconds
- macOS Testnet Preview package: pass
- ZIP: 103039 bytes; SHA-256 `d41826d277f10a96ef3c5621a3c514689d9a450f094da36c8c87fce8c1efc506`
- Executable SHA-256: `279cac226dab8fe06b9f394984a53a900d560008a44ce87a99894804b090eb56`
- ad-hoc codesign verification: pass
- macOS cold start, graceful quit and restart: pass
- Gatekeeper assessment: rejected, correctly proving the artifact is not notarized or production signed

## Not verified

- macOS Private-download normal/private interaction pair
- macOS deep-link callback interaction
- installation into a user application location
- Windows WPF build/package/install and callback protocol registration
- iOS full Xcode/simulator flow
- Android final-branch install/cold-start rerun
- Central Wallet acceptance and shared Testnet
- Public deployment, hosted artifacts, Developer ID signing, notarization and stores

## Next action

Commit and push the macOS evidence checkpoint. Then execute a deterministic normal/private download interaction or add a native evidence harness that proves only the normal download record persists, without weakening the real UI path.
