# YNX Docs, Compliance, Brand Integration Manifest

| Field | Value |
| --- | --- |
| Version | 0.2.0-candidate |
| Effective date | 2026-07-25 |
| Evidence source commit | `c8c4ff7263e50afc4c731dac8157aa85e02232dc` |
| Owner | YNX 18 Whitepaper / Compliance / Brand |
| Target branch | `codex/final-docs-compliance` |
| Status | Public candidate; centrally integrated, publicly deployed and immutably hosted; no production signing claim |

## 1. Ownership boundary

YNX 18 owns the public fact model, technical whitepaper, economic disclosure wording,
legal and compliance preparation, brand identity records, public claim controls,
search-answer source pages, localization terminology, evidence indexes, and release
status language.

YNX 18 does not own Chain Core runtime, Wallet/Auth implementation, Economics
runtime, Oracle, Bridge, Data Fabric, Security/SRE infrastructure, Website deployment,
Gateway routing, production signing, custody, provider procurement, or product-store
release. Those owners must deliver mergeable records rather than having this thread
modify their worktrees.

## 2. Protected recovery inputs

The 2026-07-25 recovery scan found owner-worktree changes that must be preserved but
must not yet be represented as accepted public facts.

| Owner | Observed state | Candidate input | Disclosure status |
| --- | --- | --- | --- |
| YNX 01 Chain Core | Clean branch with structured handoff | Four-validator, state-sync, backup/restore and EVM compatibility evidence; public deployment and BFT cutover remain false | Consume committed handoff only |
| YNX 02 Wallet/Auth | Dirty | Wallet App change and clipboard privacy implementation/test | Not accepted |
| YNX 17 Economics/Tokenomics | Dirty; latest remote CI failed | Staking risk runtime, test, checkpoint and goal assessment | Not accepted |
| YNX 19 Oracle/Market Data | Dirty | Public API/query implementation, service changes, tests and integration evidence | Not accepted |
| YNX 21 Bridge/Interoperability | Dirty | Gateway state-machine and service/type changes | Not accepted |
| YNX 26 Data Fabric/Billing/Ledger | Dirty | Goal summary and evidence-index recovery records | Not accepted |
| YNX 30 Security/SRE/Release | Staged dirty | Deployment workflow, Kubernetes controls, monitoring, backup and security automation | Not accepted |
| Ecosystem Music | Local branch ahead by 1 | Owner-local commit not yet matched by remote | Not accepted |
| Final Quant Lab | Local branch ahead by 16 | Owner-local commits not yet matched by remote | Not accepted |

No file from these worktrees may be copied into an authoritative public record until
the owner supplies a committed source identity, focused tests, release states and a
bounded handoff.

## 3. Required owner handoff record

Each product owner must provide one machine-readable record containing:

- `product`, `owner`, `branch`, exact 40-character `sourceCommit` and release identifier;
- dirty state at handoff time, which must be false for accepted source evidence;
- tests executed, exit status, environment class and evidence locations;
- separate booleans for implementation, local testing, installation, central
  integration, staging deployment, public deployment, hosted download, production
  signing and store release;
- public endpoints with direct observation class and explicit limitations;
- security, legal, economic, provider and external-audit review states;
- allowed wording, forbidden wording, expiry date and supersession link; and
- any schema, API, route, wallet, signer, custody or data-migration dependency.

Missing input keeps the corresponding release state false. A status description,
screenshot, branch name, source file or successful local test cannot be substituted
for a stronger state.

## 4. Integration sequence

1. Product owner commits and tests the owner-scoped implementation.
2. Product owner publishes a handoff with exact source and evidence identities.
3. YNX 18 validates claim wording and updates `release/facts/claims.json`.
4. Website/Gateway owners integrate the bounded fact bundle without rewriting status.
5. Security/SRE verifies artifact, route, TLS, monitoring and rollback evidence.
6. Legal, economic, audit or provider reviewers approve only their named scope.
7. YNX 18 runs the public disclosure gate and emits a candidate package.
8. Public deployment and immutable hosting require direct Website evidence; production
   signing remains a separate later approval.

## 5. Exact integration test vectors

| Vector | Input | Required result |
| --- | --- | --- |
| Network identity | `eth_chainId` | `0x1917` only for YNX Testnet |
| Native asset | Network metadata | `YNXT`, 18 decimals, Testnet qualifier |
| Mainnet boundary | Any public copy | No Mainnet-live or Mainnet-ready claim |
| Consensus boundary | StreamBFT wording | Candidate specification; public activation not established |
| Release state | Missing deployment evidence | `deployedPublic=false` |
| Legal status | Missing named counsel approval | No licensed, approved or fully compliant claim |
| Audit status | Missing named independent report | No audited, safest or secure superlative claim |
| Economics | Return, price, peg, backing or liquidity statement | Explicit no-guarantee and evidence fields required |
| Localization | Non-English record | `Machine Draft` until named human review |
| RTL | Arabic record | `direction=rtl`; runtime RTL verification remains required |
| URL proof | Operator-controlled proxy path | Candidate or Blocked only; never independent proof |
| Dirty owner worktree | Uncommitted implementation | Not accepted as canonical fact |

## 6. Current public status boundary

- Canonical identity, Testnet Chain ID and YNXT naming are evidence-linked candidate
  facts.
- Website PRs 1 and 2 integrated and refreshed the verified authority bundle; the
  accepted public content source is `9f9efcb84b59fe0b10c8a9233aa6af840f0a96a4`.
- Website PR 3 added a content-addressed package path. Direct HTTP 200 retrieval on
  2026-07-27 matched 129546 bytes and SHA-256
  `f940eda5d37606d48172cd6b7805f5f1805cc495d3bd49fb44178d01305af246`,
  with immutable caching and attachment headers.
- This operator-controlled observation proves `downloadHosted=true` for the named
  documentation ZIP only; it is not independent third-party availability evidence.
- Mainnet launch, public StreamBFT activation, staging deployment, production signing,
  legal approval and independent audit remain false or blocked.

## 7. Required local checks

```text
node scripts/verify/public-disclosure-gate.mjs
node scripts/verify/docs-compliance-check.mjs
make no-placeholder-check
make secret-scan
make objective-state-check
```

A passing local check verifies repository consistency only. It does not promote any
external, legal, economic, deployment or production state.
