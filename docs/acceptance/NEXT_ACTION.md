# Next Action

Current single action: perform the owner-controlled production validator key and private-network intake on the four real servers, then deploy the CometBFT candidate on parallel non-public ports and collect remote quorum evidence without changing public ingress.

Why this action:

- Commit `b1275c4` proves real local four-validator quorum, signed YNXT execution, 3-of-4 progress, and restart/catch-up.
- Commit `ec2f691` implements the production public-key manifest, semantic package verifier, candidate-only systemd/configuration, host-local private-key matching, strict-SSH deployment, common consensus evidence, approval-gated fault and signed-transaction drills, and candidate backup/rollback.
- `make consensus-production-package-check` builds the Linux binaries and dry-runs all four deploy/verify/fault/rollback roles using disposable keys. Package hash, semantic tamper, unsafe network/key input, divergent consensus evidence, and divergent transaction-state tests pass.
- No production validator key, real private P2P address, fresh remote migration anchor, or remote candidate currently exists. The public network remains authoritative replication, not BFT.

Required implementation work:

- Verify strict SSH identity and discover the actual RFC1918 interface/address on the primary, Singapore, Silicon Valley, and Seoul servers without printing secrets.
- Generate one CometBFT validator key and one node key directly on each assigned server under `/etc/ynx/consensus-candidate/<role>/`, mode restricted and owned for the `ynx` candidate service. Never transmit private key content through chat, logs, Git, or the public manifest.
- Extract only each derived consensus public key/address and node ID; bind them to the exact approved YNX role and private P2P endpoint in an ignored operator manifest.
- Export a fresh authoritative migration anchor, independently record its height/hash/AppHash, choose an explicit future UTC genesis time, and generate/verify the production package from commit `ec2f691` or its current successor.
- Verify private P2P firewall reachability only between the four validator servers, then run the approval-gated candidate deployment. Do not touch Caddy/Nginx/DNS or restart `ynx-chaind`.
- Collect remote common-height/hash, exact validator-set, greater-than-two-thirds precommit, and three-peer evidence. Then run the separately approved one-validator fault/recovery drill.
- Use an owner-controlled funded secp256k1 account for the signed transaction drill only after its address, backup, nonce, amount, and recipient are approved. Retain only redacted transaction/account evidence.
- Execute candidate backup and rollback rehearsal, confirm authoritative services remained active, and update state files from real evidence. Public cutover remains a later separate action.

Files to touch:

- Ignored production validator manifest and `tmp/consensus-candidate-*` evidence only after real server intake
- Candidate deployment/evidence scripts only if a real remote incompatibility is found
- `docs/acceptance/PROJECT_STATE.md`, `FEATURE_COMPLETION_TRACKER.md`, and `NEXT_ACTION.md` after remote proof
- No validator/private transaction key, mnemonic, PEM content, real `.env`, or candidate key directory in Git

Validation commands:

- `go test ./...`
- `make consensus-quorum-check`
- `make consensus-production-package-check`
- `ENV_FILE=.env.deploy make env-check`
- `make host-key-audit`
- `CONSENSUS_CANDIDATE_PACKAGE=<package> DEPLOY_DRY_RUN=1 ENV_FILE=.env.deploy make deploy-consensus-candidate`
- `CONSENSUS_CANDIDATE_APPROVED=yes CONSENSUS_CANDIDATE_PACKAGE=<package> ENV_FILE=.env.deploy make deploy-consensus-candidate`
- `CONSENSUS_CANDIDATE_PACKAGE=<package> ENV_FILE=.env.deploy make verify-consensus-candidate`
- `CONSENSUS_CANDIDATE_FAULT_DRILL_APPROVED=yes CONSENSUS_CANDIDATE_PACKAGE=<package> ENV_FILE=.env.deploy make consensus-candidate-fault-drill`
- `make no-placeholder-check`
- `make secret-scan`
- `make preflight`
- `make objective-state-check`

Completion standard:

- Four owner-controlled host-local validator/node key pairs match the exact public manifest, remain mode restricted, and are not exposed or copied into the repository.
- All four approved RFC1918 P2P endpoints are mutually reachable only as intended; candidate RPC/ABCI/metrics remain loopback-only.
- The candidate reproduces the approved migration AppHash and exact four-validator genesis, commits one common history with greater-than-two-thirds signatures, and shows all expected peers.
- The remaining three validators advance while one candidate validator/ABCI pair is stopped; the stopped role restarts and catches up to the common chain.
- An approved signed YNXT transaction commits and produces identical sender balance/nonce and recipient balance across all four applications without exposing the owner key.
- Candidate backup/rollback is rehearsed and authoritative `ynx-chaind` plus all current public services remain online and unchanged.
- Evidence stays scoped to `remote-parallel-consensus-candidate` with `publicCutoverAuthorized=false`; this action does not claim public BFT or completion.

Explicitly not doing:

- Do not generate production keys on the local lab or reuse disposable fixture keys.
- Do not send private keys, mnemonics, PEM contents, or raw secret files through chat or Git.
- Do not stop, replace, or relabel the current authoritative public network during candidate staging.
- Do not alter public ingress, Explorer feature breadth, bounded EVM opcodes, IDE samples, or unrelated ecosystem modules in this priority window.
- Do not claim remote BFT, mainnet, exchange listing, stablecoin support, wallet default support, partnerships, or full public proof before live evidence exists.
