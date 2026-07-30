# Oracle and Market Data recovery inventory

Recorded at 2026-07-22T14:17:00Z. This is engineering recovery evidence, not public product copy.

## Git baseline

- Repository: `JiahaoAlbus/YNX-Chain`
- Recovery base: `719e1018267ed5a53e6fae5211c5fd8a1503c35c`
- The designated final branch did not exist in local refs or `origin` before recovery.
- The isolated final branch was created at the recovery base without resetting, cleaning, or modifying another product worktree.
- Tags found: `finance-v1.2.0-testnet-preview.1`, `wallet-auth-evidence-da82c8b`, `ynx-browser-search-v0.2.0-preview.1`, and `ynx-mail-calendar-v0.2.0-testnet-preview-e227c4f`.
- Reflog and commit-message searches found no prior canonical Oracle branch or Oracle control-plane commit. Historical occurrences of “market” referred to unrelated product/resource markets.

## Reusable product sources

| Source branch | Source commit | Reusable ownership boundary | Finding |
|---|---|---|---|
| `codex/ecosystem-exchange` | `22604af0717a19b5f8aa9223685c3ad3f049941a` | Exchange trade tape and Quant adapter | Quant reads deterministic matched trades and refuses external prices. This is a consumer/source adapter, not an authoritative multi-source oracle. Three untracked release-record files were present and were not touched. |
| `codex/ecosystem-dex` | `1614ffb7fa4983a182405fe3fa118fa448f87b4b` | Indexed pool reserves and Q112 TWAP | DEX exposes raw reserve ratios and confirmed cumulative-price deltas. These remain explicitly non-fiat raw ratios. Worktree was clean. |
| `codex/ecosystem-finance` | `63a14500b19ab3b35e29159092973e425837a9c5` | Finance consumer semantics | No independent Oracle implementation. Two dirty release/web files were present and were not touched. |
| `codex/ecosystem-pay` | `ffb528b4971b5849ffb151a018263daf5c0e2cb0` | Pay/merchant quote consumer semantics | No independent canonical price implementation. Extensive dirty product work was present and was not touched. |
| `codex/ecosystem-explorer-monitor` | `d4b4a3e5d7d6cc5df515664eaf48f1e63a8af496` | Explorer and Monitor consumer/alert surfaces | No committed Oracle control plane. Extensive dirty product work was present and was not touched. |
| `main` / Chain Core | `719e1018267ed5a53e6fae5211c5fd8a1503c35c` | Chain integration target | No Oracle system module or precompile existed. Central worktree was clean. |

No committed standalone Quant repository or Stablecoin Oracle implementation was found. Quant is currently contained in the Exchange branch. Stablecoin documentation describes risk/deployment concerns but contains no canonical price authority.

## Worktrees and concurrent ownership

The repository registry contained main plus product worktrees for AI, Browser/Search, Cloud Docs, Developer, DEX, Exchange, Explorer/Monitor, Finance, Mail/Calendar, Music, Pay, Shop, Trust/Resource, Video, Wallet/Auth, and Social. Final worktrees existed for Chain Core, Wallet/Auth, Docs/Compliance, Bridge, and Governance. Wallet/Auth, Pay, Finance, Exchange, and Explorer/Monitor had dirty changes as described above. Those changes remain in place.

A prunable detached worktree record existed at `/private/tmp/ynx-developer-preflight-23f9adc`; it was recorded and not pruned because recovery rules prohibit destructive cleanup.

## GitHub Actions, releases, and artifacts

- No Oracle-specific workflow, release, or artifact existed in the first 100 Actions runs or first 100 artifacts.
- The latest `main` CI run at recovery time was run `29498942273` for source `719e101...` and failed because required generated Solidity artifacts were missing in `internal/bftgateway` and `internal/consensus` tests.
- The same CI log showed two validation scripts incorrectly continuing after `rg: command not found`; this is baseline supply-chain evidence and must not be treated as a passing gate.
- Existing releases were unrelated previews for Browser/Search, Finance, Mail/Calendar, and Wallet engineering evidence.
- Existing artifacts were unrelated mobile/desktop preview or simulator artifacts. None proves Oracle implementation, deployment, installation, or public operation.

## Processes, servers, and public endpoints

Interrupted recovery left bounded `git fetch` and `gh` discovery processes running temporarily. They completed without being killed. No local Oracle or Market Data daemon was found.

Public endpoint probes returned no working Chain RPC, EVM, REST, Indexer, Explorer, API, or Oracle evidence. The Oracle hostname resolved, but `/version` returned Vercel `DEPLOYMENT_NOT_FOUND`; `/health` and `/prices` did not return a successful response. Therefore `deployedStaging` and `deployedPublic` remain false.

## Recovery decision

The recovered assets are complementary inputs/consumers, not competing canonical implementations. The final Oracle control plane is therefore based on current `main`, with explicit integration contracts for Exchange trade data and DEX pool/TWAP data. Cross-product dirty work is not copied wholesale. No current source supports setting any installation, central integration, staging, public deployment, hosted download, production signing, or store-release state to true.
