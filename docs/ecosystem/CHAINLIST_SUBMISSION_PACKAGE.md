# Chainlist Submission Package

`chain-metadata/ynx-testnet.json` is the canonical YNX Testnet candidate for EVM chain/network ID `6423` (`0x1917`), native `YNXT`, public EVM RPC, Faucet, Explorer, and website metadata. The same file deterministically generates the EIP-3085 wallet payload and SDK network constants.

Generate and locally verify the testnet-only package:

```bash
make chainlist-candidate-check
make chainlist-package
```

`tmp/packages/chainlist` contains only:

- `eip155-6423.json`;
- `wallet-add-ethereum-chain.json`;
- current collision evidence;
- explicit candidate status;
- a canonical manifest bound to the current Git commit and every file digest.

The package deliberately excludes `ynx-mainnet-draft.json`. Mainnet has not launched and its draft contains no RPC, Faucet, or Explorer URL.

Run the bounded public read-only proof separately:

```bash
make chainlist-live-check
```

That command checks EVM `eth_chainId`, `net_version`, block growth, REST identity, Faucet health, Explorer/indexer health and account search, and the website. Its output remains operator-controlled evidence with `chainlistSubmitted=false`, `chainlistAccepted=false`, `walletDefaultSupported=false`, and `independentVantage=false`.

Refresh official collision evidence before any submission:

```bash
make chainlist-collision-refresh
make chainlist-candidate-check
make chainlist-live-check
```

The refresh reads the official `ethereum-lists/chains` HEAD and `chainid.network/chains.json`, records exact source/digest/time evidence, and fails if chain ID `6423`, name `YNX Testnet`, or short name `ynxt` conflicts. It does not submit a pull request.

External submission remains blocked until the owner reviews the exact package, the collision evidence is less than 24 hours old, public endpoints are stable, and submission is explicitly authorized. A generated package or passing live check is not Chainlist acceptance or wallet default support.
