# YNX Browser agent status

Updated: 2026-07-27

## Current state

- Product: 22 · YNX Browser
- Worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/22-browser`
- Branch: `codex/final-browser`
- Goal: Active
- Phase: FREEZE
- Latest protected source commit: `bde6939223693d5cdf5d05f309ac888c091ab815`
- Wallet callback runtime commit: `d9580e6b9d09a9d2eec69fbcb6d35a9ddf6997ed`
- Native download runtime commit: `668cb44dab95374ba9e5342d754b6ec568564f2b`
- Remote branch SHA before this evidence-only update: `bde6939223693d5cdf5d05f309ac888c091ab815`
- Dirty state: evidence, release and integration truth updates pending commit

## Verified

- Branch/worktree exact-match and no same-worktree concurrent writer detected.
- Local and remote SHA equality verified after every runtime checkpoint.
- Browser Node tests: 14/14 pass.
- Native macOS tests: 20/20 pass.
- Browser Smoke: pass.
- Web4 permissions/Wallet registry tests: 15/15 pass.
- Production source gate: pass.
- macOS Wallet pending state is signed with the product-device P-256 key and bound to Nonce, expiry, Chain ID, product, client, bundle, callback, algorithm and ordered scopes.
- Exact callback route/query/JSON fields, duplicate/unknown fields, escaped duplicate JSON names, byte limits, expiry, replay, tamper and wrong-device-key paths fail closed.
- Current repository Dist binary received real `ynxbrowser` protocol probes and emitted privacy-safe OSLog codes for malformed, wrong-route, duplicate-query and missing-state failures.
- OSLog event templates contain stable public error codes only; URL, Nonce, response, source and filename values are excluded.
- macOS same-host two-build reproducibility: pass; ZIP SHA-256 `fa22ac3924f68f25658257b42341f5af44274a5faa8ceceb57a2a76ef94bf2f7`.
- ZIP: 138216 bytes.
- Executable SHA-256: `cae76c48e0acb8241f3501115cee118865c3d2b54ee945b7091d4894208943a9`.
- Ad-hoc codesign verification: pass.
- macOS cold start, termination and restart: pass.
- Gatekeeper assessment: rejected, correctly proving the artifact is not notarized or production signed.

## Direct findings and boundaries

- LaunchServices knew a different user Applications copy with the same bundle identifier. Its binary SHA-256 `95ddf592badbdb3cdf4babc31c0febdd186e917d1b1ca81a4a400c2f8839d81e` does not match the current Dist binary.
- The source-mismatched app was not overwritten or deleted. Current-source probes explicitly targeted the repository Dist app; therefore `installedLocal` remains false.
- The current Dist runtime rejection evidence does not prove a centrally accepted positive Wallet/Auth callback.
- GitHub Actions API lookup failed twice with TLS handshake timeout. No CI run, Release or Artifact status was inferred.
- Native download tests cover the exact persistence function used by WKDownloadDelegate, not the full WKWebView network and NSSavePanel interaction.
- Cross-host reproducibility is not verified.

## Not verified

- Positive callback with accepted Gateway signature and product-device challenge.
- Central Wallet/Auth Product Session approve/reject/expiry/revoke lifecycle.
- Exact current-source installation and unambiguous LaunchServices ownership.
- Full macOS normal/Private download interaction recording.
- Windows WPF build/package/install and callback protocol registration.
- iOS full Xcode/simulator flow.
- Android final-branch install/cold-start rerun.
- Central Wallet acceptance and shared Testnet.
- Public deployment, hosted artifacts, Developer ID signing, notarization and stores.

## Next action

Implement a non-destructive current-source macOS install/evidence workflow that detects same-bundle collisions, preserves the existing user app, installs the reviewed artifact under an immutable evidence name, explicitly registers it with LaunchServices and proves the resolved executable hash. Do not overwrite the source-mismatched app or mark `installedLocal` true before the hash and protocol-owner checks pass.
