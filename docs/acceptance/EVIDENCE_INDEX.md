# YNX Documentation and Compliance Evidence Index

| Metadata | Value |
| --- | --- |
| Version | 0.1.0-candidate |
| Effective date | 2026-07-22 |
| Implementation source reviewed | `719e1018267ed5a53e6fae5211c5fd8a1503c35c` |
| Documentation publication commit | Pending final commit |
| Product release | YNX Testnet documentation candidate |
| Last reviewed | 2026-07-22 |
| Superseded version | None |

## Evidence rules

An evidence entry proves only its stated scope. `Passed` means the named check
completed successfully against the recorded implementation source and
preconditions. `Failed` is retained even if a later rerun passes. `Unverified`
means no direct evidence was obtained. Operator-controlled remote evidence is not
classified as independent public evidence.

Every final release entry must bind the documentation publication commit after it
exists. Until then, this index is a candidate ledger and cannot prove the package
was published, deployed, hosted, signed, or released.

## Repository and recovery evidence

| Evidence ID | Date | Scope | Result | Authority and limits |
| --- | --- | --- | --- | --- |
| REC-001 | 2026-07-22 | Baseline ref refresh and worktree recovery | Passed | Local Git and fetched `origin/main`; no prior matching docs/compliance branch found |
| REC-002 | 2026-07-22 | Existing documentation inventory | Passed | Repository file inventory; establishes presence, not quality or completion |
| REC-003 | 2026-07-22 | Product sibling-branch inventory | Passed | Local/fetched refs; candidate branches remain separately owned and are not central integration proof |
| REC-004 | 2026-07-22 | GitHub releases | Passed | GitHub CLI listed four prereleases: Browser/Search, Finance, Mail/Calendar, and Wallet engineering evidence |
| REC-005 | 2026-07-22 | GitHub Actions history | Unverified | API TLS handshake timed out; no CI conclusion inferred |
| REC-006 | 2026-07-22 | Main website reachability | Partial | `https://www.ynxweb4.com/` returned HTML to an external browser verifier; does not prove this documentation candidate is deployed |
| REC-007 | 2026-07-22 | Explorer, Faucet, EVM RPC, and API independent reachability | Unverified | External browser verifier could not safely open the service subdomains; repository URLs are not substituted for live proof |
| REC-008 | 2026-07-22 | Tokenomics candidate recovery | Passed | Reviewed committed source `ff01dcee4c93acfb138dcde91f7605e408b706d5`; later uncommitted staking work remained untouched in its owner worktree |
| REC-009 | 2026-07-22 | StreamBFT shadow-candidate recovery | Passed | Reviewed committed source `9c2d39799b9eef0be06e3b04d4ffe2e9087cc5b8`; later uncommitted asset-authorization work remained untouched in its owner worktree |
| REC-010 | 2026-07-22 | Bridge candidate recovery | Passed | Reviewed pushed source `fba6b71`; owner worktree was clean and consumer/provider handoffs were preserved as separately owned evidence |
| REC-011 | 2026-07-22 | Current final-owner worktree rescan | Passed | Recorded newer Chain/Wallet/Quant/Tokenomics/Oracle/Bridge/DEX/Governance heads and preserved owner dirty changes without modification |
| REC-012 | 2026-07-22 | GitHub Actions retry | Unverified | API TLS handshake timed out again; no CI status inferred |
| REC-013 | 2026-07-22 | Public endpoint retry | Partial | AI health returned HTTP 200 with build `02f4ccd8770c`; REST/Trust were intermittently reachable; most service domains timed out |
| REC-014 | 2026-07-22 | Server-input audit | Blocked external | Deployment env and host-key approvals absent; no unsafe SSH attempt or historical-state substitution performed |

## Documentation validation evidence

| Evidence ID | Date | Command or method | Result | Scope |
| --- | --- | --- | --- | --- |
| DOC-001 | 2026-07-22 | JSON parse with `jq -e` | Passed | Requirements matrix and both release metadata files parse as JSON |
| DOC-002 | 2026-07-22 | `make no-placeholder-check` | Passed | Existing repository filler policy over its configured runtime, docs, and scripts scope |
| DOC-003 | 2026-07-22 | `git diff --check` | Passed after metadata formatting correction | Tracked diff whitespace and conflict-marker check; final rerun required |
| DOC-004 | 2026-07-22 | Public-text internal-reference scan | Passed for current whitepaper and public metadata | Scan covered internal tool name, worktree path, local path, loopback, and disallowed filler terms; final package rerun required |
| DOC-005 | 2026-07-22 | Required release-state key assertion | Passed | Machine release record contains all nine required booleans; only documentation-package implementation and local testing are true |
| DOC-006 | 2026-07-22 | `make static-check` | Passed | Go vet plus shell and JavaScript syntax checks across configured source scopes |
| DOC-007 | 2026-07-22 | First `make test` broad run | Failed | Two API tests found missing generated selector metadata; failure retained rather than hidden |
| DOC-008 | 2026-07-22 | `npm run contracts:selectors`, focused API rerun, then `make test` | Passed | Generated five selector artifacts; all command/internal Go packages subsequently passed |
| DOC-009 | 2026-07-22 | `make smoke-test` | Passed | Local chain/EVM, AI approval, Trust/appeal, Pay, Resource, IDE, Indexer, Explorer and Faucet workflows; no remote/public claim |
| DOC-010 | 2026-07-22 | ops and BFT transaction fixture checks | Passed | Dry-run wiring, scoped backup/freeze/recovery, ten rollback injections, dependency/public continuity fixtures; not a production restore drill |
| DOC-011 | 2026-07-22 | `make docs-compliance-check` | Passed | All 37 named artifacts, nine JSON records, 13 search pages, 40 public documents and nine truthful release states passed the package gate |
| DOC-012 | 2026-07-22 | `make preflight` with pinned Prometheus 3.11.2 `promtool` and working system Python | Passed | Complete local devnet/testnet, four-validator consensus lab, production-BFT candidate and fail-closed cutover boundary suite; no remote deployment claim |

## Consensus and execution evidence

| Evidence ID | Date | Command | Result | Scope and interpretation |
| --- | --- | --- | --- | --- |
| CON-001 | 2026-07-22 | `make consensus-migration-check` | Passed | Local deterministic migration at height 1 with 6 accounts, 1 validator, and state hash `5eeb0e70fd5442474450e834f872089a25cf680393b9bc7b4f324b7c794720b1` |
| CON-002 | 2026-07-22 | `make consensus-abci-check` on fresh worktree | Failed | Two bounded-IDE tests could not find generated Hardhat artifact `SampleEVMWriteCounter.json` |
| CON-003 | 2026-07-22 | `npm ci` | Passed with security warning | Installed 91 development packages; npm reported three high-severity dependency findings |
| CON-004 | 2026-07-22 | `npm run hardhat:build` | Passed | Compiled 5 Solidity files using solc 0.8.24, Shanghai target |
| CON-005 | 2026-07-22 | `make consensus-abci-check` after artifact generation | Passed | `internal/consensus` passed; `cmd/ynx-abci` has no test files |
| CON-006 | 2026-07-22 | `make consensus-signed-transfer-check` | Passed | Focused native-envelope and application transfer tests passed locally |
| CON-007 | 2026-07-22 | `make consensus-quorum-check` | Passed | Local four-validator network, convergence, transaction, one-validator stop, and restart/catch-up gate; not remote or independent public proof |
| CON-008 | 2026-07-22 | StreamBFT candidate verification script at `9c2d39799b9eef0be06e3b04d4ffe2e9087cc5b8` | Passed | Unit and race tests passed in a detached exact-commit checkout; output explicitly kept canary/public promotion false |

## Economics evidence

| Evidence ID | Date | Command and source | Result | Scope and interpretation |
| --- | --- | --- | --- | --- |
| ECO-001 | 2026-07-22 | Economics unit tests at `ff01dcee4c93acfb138dcde91f7605e408b706d5` | Passed | Deterministic policy/simulation implementation only; not consensus or forecast evidence |
| ECO-002 | 2026-07-22 | Example simulation plus schema/source/warning assertions at `ff01dcee4c93acfb138dcde91f7605e408b706d5` | Passed | Five illustrative annual records from user-supplied test inputs; values are not actual supply, fees, burn, revenue or network statistics |
| ECO-003 | 2026-07-22 | Consensus and BFT Gateway tests on fresh exact-commit checkout | Failed before generated contract artifacts | Three bounded-IDE tests could not find the generated Hardhat artifact; retained as prerequisite evidence |
| ECO-004 | 2026-07-22 | `npm ci`, Hardhat build, then consensus and BFT Gateway tests at `ff01dcee4c93acfb138dcde91f7605e408b706d5` | Passed with dependency warning | Five Solidity files compiled; fee ledger, migration and API tests passed after artifact generation; npm still reported three high-severity findings |

## Bridge, Oracle, and Data evidence

| Evidence ID | Date | Command and source | Result | Scope and interpretation |
| --- | --- | --- | --- | --- |
| BRG-001 | 2026-07-22 | Bridge race tests at `fba6b71` | Passed | Local coordinator lifecycle, state and API code only; no external transaction |
| BRG-002 | 2026-07-22 | `make bridge-api-check` at `fba6b71` | Passed | Restart-safe intents, replay/conflict, auth, bounded JSON, truthful disabled-external-submission health/metrics and mode-restricted state |
| BRG-003 | 2026-07-22 | Documented `make bridge-integration-check` at `fba6b71` | Failed | The Make target is absent; documentation/build wiring defect retained |
| BRG-004 | 2026-07-22 | Direct integration verifier script at `fba6b71` | Passed | Eight consumer contracts, destination-confirmed availability gate, credential boundary and provider-unavailable status; does not repair missing Make target |
| BRG-005 | 2026-07-22 | Independent open/curl of Circle CCTP contract reference | Unverified | Browser retrieval did not complete and direct HTTPS timed out; owner-recorded YNX-unavailable classification remains conservative but was not independently refreshed |
| ORA-001 | 2026-07-22 | Oracle owner branch rescan | Candidate source found | Pushed `3bad8b3` adds typed feeds/store v3; untracked owner app remains untouched; no central integration/provider/public proof imported |
| DAT-001 | 2026-07-22 | Data Fabric owner branch rescan | Dirty candidate source found | Branch remains at baseline with a large uncommitted implementation; preserved in owner worktree and not claimed as integrated |

## Security and supply-chain evidence

| Evidence ID | Date | Method | Result | Required treatment |
| --- | --- | --- | --- | --- |
| SEC-001 | 2026-07-22 | `npm audit --audit-level=high` | Failed | `adm-zip <0.6.0` high-severity crafted-ZIP memory allocation advisory enters through Hardhat; npm reports no fix available |
| SEC-002 | 2026-07-22 | `make secret-scan` | Passed | Repository-configured scan passed on the current working tree; final-source rerun still required |
| SEC-003 | 2026-07-22 | SBOM and third-party notices | Partial | npm CycloneDX and Go inventories plus notices-status file exist; binary-specific coverage, licenses and approval remain |
| SEC-004 | 2026-07-22 | SAST, DAST, container and artifact scan | Partial | `go vet` passed; dedicated tools were unavailable and no current Dockerfile was found; no broad scan pass inferred |
| SEC-005 | 2026-07-22 | Threat model and security boundaries | Drafted | Required independent review and production exercises remain |
| SEC-006 | 2026-07-22 | npm CycloneDX and Go module inventory | Partial | 66 npm components and 313 Go modules recorded with hashes; binary-specific coverage and license review remain |
| SEC-007 | 2026-07-22 | `go vet ./...` | Passed | Built-in Go static checks; does not replace dedicated SAST or vulnerability scanning |
| SEC-008 | 2026-07-22 | Dedicated scanner availability audit | Unavailable | govulncheck, gosec, staticcheck, semgrep, trivy, grype and syft unavailable; no pass inferred |
| SEC-009 | 2026-07-22 | Two isolated deterministic `ynx-chaind` builds | Passed narrowly | Same-host/toolchain/source outputs matched SHA-256 `d8fc1b...c05ee`; unsigned and not cross-host/public evidence |
| SEC-010 | 2026-07-22 | Threat model and security boundaries | Drafted | `docs/security/THREAT_MODEL.md`; independent review and drills remain |

The npm finding affects development tooling, not a demonstrated production
runtime import. That boundary reduces exposure but does not resolve the advisory.
The release must document accepted mitigation, isolation, upgrade monitoring, or
replacement before claiming the supply-chain gate passed.

## Release and public evidence

| Evidence ID | Scope | Current result |
| --- | --- | --- |
| REL-001 | Documentation package complete | Proved locally by the named-artifact gate; publication remains pending |
| REL-002 | Full local validation | Complete local preflight and docs-compliance gate passed on 2026-07-22 |
| REL-003 | Website handoff accepted | Not proved |
| REL-004 | Staging deployment | Not proved |
| REL-005 | Public deployment | Not proved |
| REL-006 | Immutable hosted download with digest and bytes | Not proved |
| REL-007 | Production signature | Not proved |
| REL-008 | Store release | Not applicable to the documentation artifact, retained false in the common state schema |
| REL-009 | Independent legal review | Not proved |
| REL-010 | Independent security review | Not proved |
| REL-011 | Independent economic review | Not proved |
| REL-012 | Website integration handoff and structured-data suggestions | Drafted; Website acceptance not proved |
| REL-013 | Press/support/incident/launch/legal packet | Drafted; external owners and approvals not proved |
| REL-014 | Local read benchmark | 5,000/5,000 development reads passed; no production capacity claim |

## Evidence sources to reconcile

The repository’s historical `docs/acceptance/PROJECT_STATE.md` contains valuable
operator-controlled remote observations and exact source commits. Each fact used
in public text must be rechecked against its referenced source, current remote
state, and evidence artifact. Historical observations do not prove current
availability.

Product-specific branches contain newer candidate evidence. No candidate claim
is imported merely because the branch is newer or its tests passed. Import
requires ownership-safe review, exact source commit, evidence classification, and
central integration status.

## Change log

- 0.1.0-candidate (2026-07-22): Added recovery, documentation, consensus,
  dependency, release, and public-evidence records from the first audit and
  focused verification pass.
