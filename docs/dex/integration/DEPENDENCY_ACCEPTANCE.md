# YNX DEX dependency acceptance

Accepted locally:

- Central Wallet registry v2 parses and enables only the exact reviewed DEX tuple.
- Wallet and DEX action cryptography is owned by `packages/wallet-auth`; DEX does not implement another signer.
- The positions path uses a one-time product-device proof and central introspection.
- DEX uses confirmed indexer events and owner-reviewed Testnet token metadata; reserve ratios are not presented as fiat prices.
- DEX Hardhat outputs are isolated from other product evidence.

Not accepted publicly:

- The public Wallet Gateway has not been proven to run this registry revision.
- No verified DEX Factory, Router, Quoter or Pool address is recorded for the shared Testnet.
- No reviewed funded pool, swap receipt, LP position, fee attribution, kill/revoke or emergency-exit public evidence exists.
- No independent contract audit, staging URL, public PWA, hosted download, signing or store release exists.

These absences keep every corresponding release flag false and every transaction control fail-closed.
