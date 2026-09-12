# Dedicated Card Testnet funding control proposal

Status: configuration proposal only. No issuer key or address was generated, no user account was accessed, no signature or transaction was sent.

The tracked Card product configuration inspected at source `4b358064f63bd9f5b69ed31d54d721b602cfc3dc` exposes an unset server-side `YNX_CARD_TESTNET_FUNDING_ADDRESS`. No proven controlled issuer/treasury address was found there. Do not adopt a test fixture address, user account, Finance address or arbitrary chain address as Card treasury.

## Host-controlled preparation

1. Wallet/Core owner identifies the accepted account-generation and public-key derivation interface; use that interface in an isolated host operation, not a new Card signing implementation. The operator creates one dedicated YNX Testnet Card issuer account on the designated service host.
2. Store the issuer secret only in a root-owned 0700 directory such as `/etc/ynx-card/credentials`, in a new root-owned 0600 credential file. Never print it, commit it, attach it to evidence, place it in CLI arguments or pass it through an application response.
3. Keep an encrypted recovery copy under a root-only recovery location separate from the SQLite backup and its distinct storage encryption key. The recovery decryption credential is retained outside the same backup set. Restore/control verification is required before receiving funds.
4. If an authorized issuer operation eventually needs the secret, use systemd `LoadCredential` for that isolated operation and the accepted signing interface. The public Card HTTP service currently only verifies inbound chain receipts and does not need issuer signing power; do not expose the issuer credential to `ynx-cardd` just to accept funding.
5. Publish only the derived public key, native YNX address, corresponding EVM recipient, chain `0x1917`, creation source/tool identifier, protected file mode receipt and a public control-verification result. A control signature requires the applicable explicit authorization and is not a user payment.
6. After control and recovery are proven, configure the public EVM recipient in root-managed Card service configuration. Set the coordinator-assigned service RPC `https://rpc.ynxweb4.com`. Neither value may come from an HTTP request.

## Money-movement boundary

Only an ACTIVE application with verified Wallet business approval and backend receipt may create a funding intent. The user separately reviews and approves exact Testnet YNXT sender/recipient/value/chain in Wallet. Card credits its ledger only after independent receipt/block/confirmation/replay verification. No issuer control check, callback, UI state, synthetic fixture or service start substitutes for that chain transaction. Real-world card payments, fiat, PAN/CVV and merchant settlement remain unavailable.
