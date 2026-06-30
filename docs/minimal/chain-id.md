# Chain ID Decision Log

YNX Chain must use numeric chain IDs because EVM wallets and EIP-155 require numeric IDs.

User preference:

- Avoid `9`, `1`, `8`, and `7` when possible.
- Prefer shorter IDs.
- Avoid repeated digits.
- Do not use `9102`.
- Do not publish final mainnet IDs without checking public registries.

## Reserved Candidates

Checked against `https://chainid.network/chains.json` on 2026-06-30:

| Network | Chain ID | Result |
| --- | ---: | --- |
| YNX Mainnet | 6420 | Free in checked source |
| YNX Testnet | 6423 | Free in checked source |
| YNX Devnet | 6425 | Free in checked source |

Blocked during the same check:

| Chain ID | Reason |
| ---: | --- |
| 4203 | Taken by Merlin Erigon Testnet |
| 5042 | Taken by Arc |

Before public release, recheck EIP-155, ChainList, and chainid.network, then record date, source, and commit hash.

