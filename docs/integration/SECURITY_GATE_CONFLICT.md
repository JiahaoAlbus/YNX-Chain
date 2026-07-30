# Wallet/Auth security-gate conflict

Date: 2026-07-27  
Owner of affected central scripts: 30 Security / SRE / Release  
Wallet/Auth impact: evidence classification only; no central script is modified from this worktree.

## Conflict

The repository-level targets `make no-placeholder-check` and `make secret-scan` invoke shell scripts that require `rg`. On this verified host, `rg` is unavailable. Both scripts emitted `rg: command not found` but still exited with status 0 and printed a success message. Therefore those two invocations are not valid Wallet release evidence.

## Wallet fail-closed mitigation

Wallet adds `npm run release-content:check`, implemented without external binaries. It scans the Wallet runtime source, app configuration and public/release metadata for disallowed filler claims and common literal secret signatures. It is part of `npm run check`, so absence of `rg` cannot produce a false green Wallet release gate.

## Required central resolution

30 Security/SRE should make the central scripts fail immediately when required scanners are missing, or replace the dependency with a repository-pinned implementation. The resolution should include a negative test proving that a missing scanner cannot emit success.

This conflict does not claim the repository-wide placeholder or secret scan passed. It records only the independently executed Wallet-owned gate and its bounded coverage.
