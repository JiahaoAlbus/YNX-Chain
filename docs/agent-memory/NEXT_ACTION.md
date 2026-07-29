# Next Action

Updated: `2026-07-29T02:44:44Z`

1. Run the Integration acceptance validator and complete protection preflight against the current coverage-generator, metadata, release and recovery-memory changes.
2. Review the complete diff and commit it as one Integration-owned evidence/recovery slice.
3. Push `codex/final-integration` and verify Local SHA equals Remote SHA.
4. Open a pull request from `codex/final-integration` to `main` to trigger the repository CI workflow.
5. Inspect every job for the exact PR head SHA; fix failures without weakening gates.
6. After green CI, regenerate the matrix/GitHub snapshot against the protected source and begin explicit Phase 0 bundle review in dependency order.

Do not centrally accept any product merely because its matrix row is `implementedLocal`; acceptance requires exact owner tests, central negative vectors, artifact verification and dependency approval.
