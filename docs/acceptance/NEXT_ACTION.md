# Next Action

Current single action: expose the now-deployed dual-address feature on the production website without changing its chain-first truth boundaries.

Why this action:

- Release `97ed0c645bd2` is deployed on all four authoritative roles with exact checksum and convergence evidence.
- Public RPC and Explorer prove one `ynx1...` alias and its `0x...` representation resolve to the same account through an operator-controlled Singapore route.
- The user requires completed ecosystem capabilities to appear on the website, and this capability now has real code and public deployment evidence.

Required behavior:

- Add a focused address converter to the existing website developer/wallet surface using the same tested Bech32 algorithm and shared fixture values.
- Accept either `0x...` or `ynx1...`, show both equivalent forms, expose copy actions, and provide a direct Explorer lookup.
- State clearly that MetaMask/EVM JSON-RPC use `0x...`; do not claim wallet-default `ynx1...` support.
- Preserve the Apple-inspired Klein-blue/white visual system, CSS/DOM interaction, current route structure, real network data, mobile layout, and error boundaries.
- Add deterministic frontend tests for valid vectors and invalid checksum/case/length inputs.
- Deploy only from `JiahaoAlbus/YNX-Chain-website` `main` through Vercel project `ynx-web4-website-new`, then verify the production route and interaction.

Files to touch:

- `/Users/huangjiahao/Desktop/YNX-Chain-website` frontend, tests, and route metadata.
- Chain acceptance files only after production website proof; do not duplicate website runtime into the chain repository.

Validation commands:

- website repository test and production build commands
- Vercel production build and deployment verification
- desktop and 390px mobile browser checks
- production converter vector, invalid-input, copy, Explorer-link, route, overflow, and console checks
- chain `make no-placeholder-check`, `make secret-scan`, and `make objective-state-check` after recording production evidence

Completion standard:

- Production website converts the shared known vectors byte-for-byte in both directions.
- Invalid input never produces a plausible address or Explorer link.
- The UI explains one account/two representations and the MetaMask `0x...` boundary without unsupported claims.
- The intended Git commit is the source of a READY Vercel production deployment and the live route is browser verified.

Explicitly not doing:

- No new chain address features, EVM opcodes, Counter/Hardhat expansion, arbitrary IDE execution, or unrelated Explorer redesign during this website slice.
- No signer upload, freeze, pause, ingress switch, or BFT cutover without independent custody approval.
- Do not modify or replace the long-term goal file.
