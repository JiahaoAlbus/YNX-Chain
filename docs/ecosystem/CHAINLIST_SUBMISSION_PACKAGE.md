# Chainlist Submission Package

Prepared fields: chain name, chainId, native currency, RPC URLs, public RPC health, explorer URL, faucet URL, icon URL, website URL, docs URL, support contact, GitHub repo, public testnet status, demo tx, demo contract, RPC compatibility checklist, chainId conflict result.

Submission is blocked until real public URLs and proof hashes are supplied.

Generation command:

```bash
make chainlist-package
```

The generator validates `chain-metadata/ynx-testnet.json`, copies the testnet and mainnet draft metadata into `tmp/packages/chainlist`, and writes a manifest with file hashes and the current git commit. The package remains draft-ready until real public URLs and proof hashes are added.
