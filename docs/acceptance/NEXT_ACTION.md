# Next Action

Current single action: build a production-grade YNX Testnet Chainlist and MetaMask integration candidate from verified public endpoints without claiming external acceptance.

Why this action:

- Commit `6c7e2f37a6c8` completes the locally reproducible SDK artifact and verification boundary; production signing and registry publication now require owner-controlled external approval and credentials.
- `chain-metadata/ynx-testnet.json` still contains empty RPC, Faucet, and Explorer arrays plus stale draft language even though the authoritative YNX Testnet has operator-controlled public endpoint proof.
- A strict metadata validator, live identity probe, EIP-3085 payload, collision evidence, deterministic package, and wallet-provider tests can advance ecosystem readiness without private keys or external submission authority.

Required behavior:

- Define schema-valid YNX Testnet metadata for chain/network ID `6423`, EVM hex `0x1917`, native `YNXT` with 18 decimals, HTTPS EVM RPC, Faucet, Explorer, info URL, short name, and EIP-3091 Explorer standard.
- Keep `ynx-mainnet-draft.json` explicitly draft-only with no public RPC/Faucet/Explorer and exclude it from any testnet submission candidate.
- Generate one canonical EIP-3085 `wallet_addEthereumChain` payload from the same metadata source; no duplicated handwritten chain constants.
- Add a bounded EIP-1193 helper/test flow for add, switch, user rejection, unsupported method, wrong post-switch chain, and provider absence without requesting seed phrases or private keys.
- Add a strict metadata/package verifier that rejects HTTP/localhost URLs, duplicate or unknown fields, ID/currency mismatch, malformed Explorer entries, mainnet leakage, stale/missing collision evidence, changed package files, and noncanonical JSON.
- Add a live read-only verifier for `eth_chainId`, `net_version`, positive/growing block height, REST chain identity, Faucet health, Explorer health/search boundary, and TLS endpoint identity with bounded retries/timeouts.
- Capture a source-attributed, dated, digest-bound chain-ID collision snapshot and fail closed if `6423` is already assigned to another chain; require refresh before submission.
- Produce a deterministic testnet-only submission package with exact Git commit, file digests, endpoint-proof status, and truthful `not submitted / not accepted / no wallet default support` fields.
- Update wallet/Chainlist and acceptance documentation only after code and checks exist.

Files to touch:

- `chain-metadata`
- `sdk/js` for bounded EIP-1193 integration
- `scripts/package/chainlist-package.sh` or a structured replacement
- `scripts/verify/wallet-integration-check.sh` and new focused metadata/live verifiers
- `Makefile`
- ecosystem and acceptance documentation after implementation

Validation commands:

- focused metadata schema, canonical payload, provider behavior, collision, tamper, and live-probe fixtures
- `make wallet-integration-check`
- `make chainlist-package`
- a dedicated Chainlist candidate integrity check
- `make sdk-check`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `go test ./...`
- `make test`
- `make preflight`
- `make objective-state-check`

Completion standard:

- One canonical metadata source deterministically generates the exact EIP-3085 payload and testnet-only submission package.
- Local fixtures prove every fail-closed rule, and a bounded live read-only run proves the named public endpoints report YNX Testnet `6423` / `0x1917` / `YNXT` with growing blocks.
- Wallet-provider tests prove add/switch/rejection/mismatch behavior without reading or creating any account secret.
- Status remains candidate-only until an external Chainlist review accepts the exact package and independent wallet clients verify the accepted registry entry.

Explicitly not doing:

- No Chainlist pull request or third-party submission before fresh collision evidence, stable live endpoint proof, owner review, and explicit authorization.
- No claim of Chainlist acceptance, wallet default support, mainnet launch, exchange listing, stablecoin issuer support, partnership, npm/PyPI publication, or public BFT completion.
- No YNX Mainnet RPC/Faucet/Explorer publication while mainnet is not launched.
- No wallet seed phrase, private key, account export, automatic transaction, or hidden provider permission request.
- No public BFT freeze, signer install, ingress switch, or cutover without existing custody and transaction approvals.
- No expansion of bounded EVM or IDE execution.
- Do not modify or replace the long-term goal file.
