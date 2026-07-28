# YNX Video agent status

- Product: YNX Video
- YNX owner: 33
- Workspace: `/Users/huangjiahao/Desktop/YNX Final Worktrees/33-video`
- Branch: `codex/final-video`
- Upstream: `origin/codex/final-video`
- Current phase: PROTECT → FREEZE
- Long-term status: ACTIVE
- Runtime source commit: `11e64797c64cd64d1c6e53f0295c17997bde6f97`
- Last verified remote SHA: `11e64797c64cd64d1c6e53f0295c17997bde6f97`
- Concurrent writer detected: no

## Latest verified slice

Upload integrity and rights provenance are now mandatory for new media. The service compares the declared SHA-256 with streamed bytes, persists a structured rights declaration, rejects malformed or expired declarations and prevents publication when rights are absent or expired. Legacy rightsless records still pass state-HMAC verification but cannot be republished until corrected.

## Gates

Passed:
- `go test -race ./internal/video/...`
- `go vet ./internal/video/...`
- `npm --prefix apps/video run check`
- `npm --prefix apps/video run smoke`
- `npm --prefix apps/creator-studio run check`
- `npm --prefix apps/creator-studio run smoke`
- `git diff --check`

Not counted as passed:
- `go test ./...`: unrelated shared failures in consensus/faucet/trust and missing IDE artifact; Video package passed.
- `make no-placeholder-check`: false-green because `rg` is unavailable.
- `make secret-scan`: false-green because `rg` is unavailable.
- Current-source ClamAV loopback smoke: local daemon configuration/signature database unavailable.

No production, public deployment, hosted download, production signature, store release or real revenue claim is made.
