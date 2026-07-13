# Next Action

Current single action: implement reversible YNX human-readable account addresses without breaking EVM compatibility.

Why this action:

- The user explicitly identified that raw `0x...` addresses do not provide a visible YNX-native identity.
- YNX remains an L1 because chain identity comes from its own state and chain ID; `0x...` is required by EVM tooling, not evidence that accounts live on Ethereum.
- Public BFT and provider-backed AI generation remain externally blocked, while dual-address support is a real locally actionable Wallet/SDK/RPC/Explorer feature.

Required behavior:

- Use the same canonical 20 account bytes for both representations.
- Add checksummed Bech32 `ynx1...` encode/decode and strict rejection for wrong HRP, mixed case, bad checksum, wrong payload length, and malformed hex.
- Preserve lowercase canonical `0x` addresses inside consensus state and EVM JSON-RPC.
- REST/native transaction entry points may accept either representation but must normalize before signing, hashing, persistence, or comparison.
- JS and Python SDKs must provide dependency-free conversion helpers with matching fixtures.
- Explorer/account APIs should expose and search both representations only after the shared codec and tests exist.
- Do not claim MetaMask supports `ynx1...`; MetaMask continues to use the equivalent `0x...` address.

Files to touch:

- `internal/consensus/transaction.go` and shared address validation call sites.
- A small shared Go address-codec package, with focused tests.
- `cmd/ynx-consensus-account-key` and native transfer input normalization.
- `sdk/js`, `sdk/python`, and their fixture tests.
- Explorer API/UI only after the codec contract is stable.
- Makefile/check scripts and acceptance tracker.

Validation commands:

- `go test ./...`
- new focused address-codec tests and command check
- `make sdk-check`
- `make explorer-check` after Explorer support exists
- `make test`
- `make no-placeholder-check`
- `make secret-scan`
- `make objective-state-check`

Completion standard:

- Go, JavaScript, and Python encode/decode the same fixtures byte-for-byte.
- Native REST/CLI paths accept `ynx1...` and canonicalize to the same account as `0x...`.
- EVM JSON-RPC remains unchanged and EVM/MetaMask tests still pass.
- Explorer displays/searches the alias without changing stored account identity.
- No remote deployment or public proof claim until the exact chain release is deployed and verified.

Explicitly not doing:

- No new EVM opcodes, Counter/Hardhat expansion, arbitrary IDE execution, or unrelated Explorer redesign.
- No signer upload, freeze, pause, ingress switch, or BFT cutover without independent custody approval.
- Do not modify or replace the long-term goal file.
