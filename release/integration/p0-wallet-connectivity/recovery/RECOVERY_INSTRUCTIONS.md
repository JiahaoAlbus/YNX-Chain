# P0 Recovery Instructions

Direct push to `codex/final-integration` was rejected twice on 2026-08-20 by
the protected-branch policy. The remote requires a pull request and six required
status checks. This is a policy gate, not a claim that the P0 source is public.

## Recovery source

- Base: `origin/codex/final-integration` at `038600d05bbb797352d25be96d0829bde07a70b7`
- Protected P0 head: `86e20fb9d96ddb6cdbf9d8a5f33133b2ecfa0630`
- Incremental bundle: `p0-wallet-connectivity-20260820.bundle`
- SHA-256: `57e34123381ac3b4a86845cc0a9dde1b99e621e11d888fe5a2ff88fb8b34e472`

## Restore procedure

1. Verify the bundle SHA-256 against this manifest.
2. Run `git bundle verify p0-wallet-connectivity-20260820.bundle`.
3. Fetch the bundle into an isolated recovery ref.
4. Compare the recovered head to `86e20fb9d96ddb6cdbf9d8a5f33133b2ecfa0630`.
5. Open or continue the required PR into `codex/final-integration`; do not force
   push and do not rewrite the protected branch.

## Diff summary

The preserved range contains 26 commits and 294 changed files, with 74,058
insertions and 3,966 deletions. It includes prior Calendar, Explorer/Indexer,
Pay, Fable5 audit, and this P0 control-plane commit.
