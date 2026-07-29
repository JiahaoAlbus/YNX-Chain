# YNX 27 DEX next action

Freeze a clean-room concentrated-liquidity v1 specification, then implement the first invariant-tested pool slice.

The slice must define and test:

- immutable token ordering and reviewed fee tier;
- tick spacing and bounded initialized-tick transitions;
- range-liquidity mint/burn ownership accounting;
- exact fee-growth accounting with rounding direction stated;
- callback payment verification and reentrancy rejection;
- price-limit, overflow and zero-liquidity failure behavior;
- malicious, fee-on-transfer and rebasing token boundaries;
- explicit non-support for routing, Oracle claims and production deployment until later slices.

Required checkpoint before stopping:

1. specification and source remain inside the YNX 27 worktree;
2. focused unit, differential and stateful invariant tests pass;
3. Diff is reviewed;
4. commit is pushed to `origin/codex/final-dex`;
5. Local SHA equals Remote SHA;
6. feature evidence and recovery checkpoint are updated without claiming integration or deployment.
