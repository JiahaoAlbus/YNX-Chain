# YNX Browser agent status

Updated: 2026-07-27

## Current state

- Product: 22 · YNX Browser
- Worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/22-browser`
- Branch: `codex/final-browser`
- Goal: Active
- Phase: FREEZE
- Latest protected source commit: `f2f9aaed8d3e4231d37c94de352077008a338572`
- Native download runtime commit: `668cb44dab95374ba9e5342d754b6ec568564f2b`
- Remote branch SHA before this evidence-only update: `f2f9aaed8d3e4231d37c94de352077008a338572`
- Dirty state: evidence, release and `.ai-bridge` truth updates pending commit

## Verified

- Branch/worktree exact-match and no same-worktree concurrent writer detected.
- Local and remote SHA equality verified after both new runtime commits.
- Browser Node tests: 14/14 pass.
- Native macOS download-persistence tests: 3/3 pass.
- Browser Smoke: pass.
- Web4 permissions/Wallet registry tests: 15/15 pass.
- Production source gate: pass; the runtime `example.com` fallback was removed in favor of fail-closed `about:blank`.
- macOS Swift 6.1 arm64 release build: pass.
- macOS Testnet Preview ZIP integrity: pass.
- Same-host two-build reproducibility: pass; SHA-256 `df24eb70667572b3122137f41883bc9d6b02bec8e7728e727b44bcb09cc176ce`.
- ZIP: 109273 bytes.
- Executable SHA-256: `822947dd8a9146e66274d3ebce1ff56d2e3e2a476493d8069611d7d88e9769dc`.
- Ad-hoc codesign verification: pass.
- macOS cold start, graceful quit and restart: pass.
- Gatekeeper assessment: rejected, correctly proving the artifact is not notarized or production signed.

## Direct failures and boundaries

- GitHub Actions API lookup failed twice with TLS handshake timeout. No CI run, Release or Artifact status was inferred from that failure.
- Native download tests cover the exact persistence function used by WKDownloadDelegate, not the full WKWebView network and NSSavePanel interaction.
- Cross-host reproducibility is not verified.

## Not verified

- Full macOS normal/Private download interaction recording.
- macOS `ynxbrowser` callback interaction and rejection-state drill.
- Installation into a user application location.
- Windows WPF build/package/install and callback protocol registration.
- iOS full Xcode/simulator flow.
- Android final-branch install/cold-start rerun.
- Central Wallet acceptance and shared Testnet.
- Public deployment, hosted artifacts, Developer ID signing, notarization and stores.

## Next action

Extract the macOS preliminary Wallet callback validator into the shared native core, reject malformed/unknown/expired/wrong-binding/replayed responses in deterministic tests, and keep the runtime message explicit that Gateway signature and device challenge verification are still required before any Product Session exists.
