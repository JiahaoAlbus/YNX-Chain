# Next action

Run a bounded read-only ClamAV recovery audit from this worktree:

1. Record `clamscan --version` and `freshclam --version`.
2. Run the configured scanner readiness probe used by YNX Video without changing source or system configuration.
3. If a usable signature database is present, execute the repository-owned media loopback E2E and refresh `docs/handoffs/video-evidence/media-smoke.json` against the current branch head.
4. If the database/configuration remains unusable, preserve the raw command evidence, classify it as local execution infrastructure, and continue with the current-source backup/restore drill rather than claiming Testnet verification.

After any successful modification: test, inspect diff, commit, push, verify Local SHA equals Remote SHA, then update this checkpoint.
