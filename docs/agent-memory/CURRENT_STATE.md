# Current State — YNX 21 Bridge

Updated: 2026-07-29T02:55:04Z

- Product number: `21`
- Product name: `YNX Bridge & Interoperability`
- Worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/21-bridge`
- Branch: `codex/final-bridge`
- Local SHA: `8c96a3fd22b7f32dbdb5b99f5048b1f527db63ef`
- Remote SHA: `8c96a3fd22b7f32dbdb5b99f5048b1f527db63ef`
- Main SHA: `0ad0aaec7a96f1efcb871247cc9e0161ba6a01cc`
- Ahead / behind: `0 / 0`
- Dirty state at checkpoint: `false`
- Phase: `TESTNET`
- Goal state: `ACTIVE`

## Latest successful tests

- `go test -race ./internal/bridgegateway ./cmd/ynx-bridged ./internal/appgateway ./cmd/ynx-app-gatewayd`
- `make bridge-api-check`
- `make bridge-integration-check`
- `make bridge-supply-chain-check`
- `make bridge-observability-check`
- `make bridge-dependency-audit-check`
- `make bridge-sdk-check`
- `make bridge-route-adapter-check`
- `make bridge-provider-check`
- `make bridge-data-lifecycle-check`
- `make bridge-capacity-check`
- `make bridge-migration-check`
- `make bridge-restore-check`
- `make bridge-evidence-check`
- `make no-placeholder-check`
- `make secret-scan`
- Two restore drills executed concurrently and passed.

## Latest CI

- Workflow: `bridge`
- Run: `30418066262`
- Job: `90468772242`
- Commit: `8c96a3fd22b7f32dbdb5b99f5048b1f527db63ef`
- Conclusion: `success`
- Verification artifact ID: `8710873711`
- Artifact digest: `sha256:36cef9b1f4928263ca1f591c322597add85c6ac49c5df2b38a6652414aeb33ec`
- Artifact expiry: `2026-08-28T02:55:04Z`
- Artifact boundary: expiring Actions verification evidence, not an immutable release download.

## Pull requests and releases

- Pull request for `codex/final-bridge`: none.
- Bridge-specific GitHub release: none.
- Production-signed release: none.

## Runtime and public deployment

- Deployed runtime commit: `857371f9b19422861c0675ca6cbd89a7750744ad`
- Remote coordinator and canonical App Gateway: staged and directly evidenced.
- Public read-only base: `https://rest.ynxweb4.com/app/bridge`
- Public runtime status: `https://rest.ynxweb4.com/app/bridge/status`
- Public product route: `https://ynxweb4.com/bridge`
- Product route HTTP 200: verified.
- Product-specific route canonical/title/description/Open Graph/JSON-LD: not verified.
- Public mutation: disabled.
- External submission: disabled.
- User asset movement: disabled.
- Executable YNX route: unavailable.
- Funded Testnet deposit/withdrawal: not verified.

## Completed

- Exact Worktree, branch, remote, history, CI, evidence and public runtime recovered.
- Stale claims that App Gateway integration was missing were corrected.
- Restore drill fixed to avoid fixed-port collisions.
- Public read-only and executable-product states are separated in release metadata.
- Website correction handoff created for owner `28-website`.

## Remaining

- Publish immutable unsigned Testnet candidate artifacts with SHA-256, SBOM and provenance.
- Verify downloaded bytes, installation and cold start.
- Obtain cross-owner dependency acceptance.
- Redeploy and re-probe the latest verified runtime source.
- Obtain approved route, contracts, funded assets, signer custody, security review and governance authority.
- Execute and evidence funded deposit, withdrawal and failure/recovery flows.

## Current risks

- The staged runtime is behind the latest verified source.
- Actions artifacts expire and are not release downloads.
- Generic SPA metadata can misrepresent `/bridge` SEO and canonical identity.
- A threshold-relayer verifier must not be described as a trustless or canonical Bridge proof.

## Evidence

- `docs/bridge/EVIDENCE_INDEX.md`
- `docs/bridge/FEATURE_COMPLETION_EVIDENCE.md`
- `docs/bridge/TESTNET_READINESS_STATUS.md`
- `docs/bridge/product-release.json`
- `docs/bridge/public-product-metadata.json`
- `docs/bridge/website-handoff.json`
- `docs/integration/INTEGRATION_HANDOFF.md`
- `release/bridge/product-release.json`
- `release/bridge/public-product-metadata.json`
