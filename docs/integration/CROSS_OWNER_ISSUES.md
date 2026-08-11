# YNX DEX cross-owner issues

Updated: 2026-07-29T02:53:09Z

## DEX-XPROD-001 — Repository-wide IDE selector metadata tests fail

- Classification: cross-product repository gate; not caused by YNX 27 changes
- Suggested owner: YNX 11 Developer / YNX 01 shared chain runtime
- Failing command: `go test ./...`
- Failing package: `github.com/JiahaoAlbus/YNX-Chain/internal/api`
- Failing tests:
  - `TestIDECompileUsesHardhatArtifactWhenSourceMatches`
  - `TestIDEExecuteSupportsGenericPinnedWriteCallSubset`
- Direct symptom: Hardhat artifact ABI entries report `selectorSource=hardhat-ethers-keccak-selector-metadata`, but `selector` is empty for `balanceOf(address)`, `count()` and `increment(uint256)`; `runtimeSelectorMode=missing-hardhat-selector-metadata` and `deployedBytecodeSelectorMatches=0`.
- Scope check: no `internal/api`, Developer IDE, Hardhat artifact or selector-generation file is modified by the YNX 27 recovery checkpoint.
- DEX impact: focused DEX Go Race tests, SDK tests, PWA tests/build, manifest checks, source binding and artifact verification pass. Repository-wide CI would still fail until the shared selector metadata defect is resolved.
- Required owner action:
  1. reproduce both tests from the authoritative Developer/API worktree;
  2. verify selector generation against the pinned Hardhat/Ethers artifact pipeline;
  3. regenerate or repair selector metadata without weakening the tests;
  4. run `go test ./internal/api` and then `go test ./...`;
  5. return the exact source commit and CI evidence to YNX 27/29.
- YNX 27 acceptance condition: merge or dependency acceptance identifies a commit where both failing tests and the repository-wide Go suite pass without changing DEX security boundaries.

YNX 27 must not modify the shared Developer/API implementation from the DEX worktree merely to make this gate green.
