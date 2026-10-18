# Wallet dual-PQ backup candidate

This SDK candidate adds an encrypted backup container and protected-main key
custody adapter. It preserves the original chain identity and owner; it does not
derive a replacement address, change nonce/balance/history, perform migration,
or activate any transaction policy.

## Inputs and ownership

- Renderer/public data: `@ynx-chain/wallet-auth/pq-wallet-contract`.
- Protected main container: `@ynx-chain/wallet-auth/pq-wallet-backup`.
- Protected main key custody: `@ynx-chain/wallet-auth/pq-wallet-key-backup`.
- Sole crypto provider: exact `@ynx/batch-v01-candidate@0.1.0-candidate.2`, installed
  from the separately supplied, hash-verified package. No alternate engine or
  silent provider fallback. The adapter explicitly selects `portable`.
- The provider is an optional peer so existing non-PQ SDK entry points do not
  acquire a new crypto runtime requirement. The key-custody entry point fails
  closed if that exact provider is not supplied. Consumers must lock Noble
  post-quantum 0.6.1 and hashes/curves/ciphers 2.2.0 as recorded by the provider.

`PQPublicBinding` contains the fixed protocol version and suite, original 32-byte
chain identity in lowercase hex, original ASCII owner, and both complete public
keys in canonical unpadded base64url (2592 and 64 bytes). Validating this object
does not authenticate its provenance or establish chain registration.

## Backup and recovery

1. Protected main creates a key handle with `createPQWalletKeyHandle(network)`.
   The sole protocol provider generates both algorithms using separate fresh
   CSPRNG requests. Neither mnemonic nor account-derived seed is used.
2. `createPQRecoveryCredential()` creates an independent random 256-bit recovery
   credential. The user must save it separately from the encrypted backup; it
   cannot exist only in a device keychain. This format does not accept a human
   password or an old mnemonic as a substitute.
3. `exportPQWalletBackup(handle, credential)` exports both provider PKCS8 keys
   only within protected main and encrypts them together. Version, suite,
   chain, owner, both public keys, salt, KDF and nonce are authenticated.
4. Recovery obtains `expectedBinding` from a trusted original or protected chain
   registration query, independently of the file preview. It then calls
   `restorePQWalletKeyHandle(bytes, credential, expectedBinding)`. Both DER keys
   are imported atomically by the sole provider, both public keys are recomputed
   and matched, and only then is an opaque custody handle returned.

The v1 envelope uses fixed PBKDF2-HMAC-SHA256/600000 and AES-256-GCM, a fresh
32-byte salt and 12-byte nonce. Unknown fields, noncanonical JSON/base64url,
oversized files, wrong binding, wrong credential and modified ciphertext fail
closed. Internal mutable temporary secret byte copies are cleared; JavaScript
strings, allocator copies and runtime key storage have no guaranteed physical
zeroization. Never log credentials, either private key, or decrypted material.

`openPQWalletBackup` only opens the encrypted material container. It is **not**
the complete Wallet restore operation. A custody handle is **not** transaction
authority. Current-account authorization, trusted migration proofs, activation
height, current registration and the policy at every transaction/recovery/
delegation entrance must still be supplied by the real chain integration.
This candidate exposes no transaction-signing fallback to the old mnemonic.

## Lifecycle

The App owner captures the complete returned handle before checking its original
operation/session fence. A lock, cancellation, close or account change retires
that same handle with `destroyPQWalletKeyHandle`; it cannot be revived after
unlock. `exportPQWalletBackup` also checks retirement after the asynchronous KDF.

Cleanup is independent of the operation's first cause. `readPQWalletKeyCleanupOutcome`
and `pqWalletKeyCleanupUnresolved` expose only redacted state. Unknown cleanup
is retained privately, blocks another acquisition and is not automatically
retried. Saved facts and unknown repository effects remain the App owner's
existing original-record reconciliation responsibility.

## Actual validation and remaining gates

The container controls passed in Node and the actual R24 Electron 42.10.0 /
Node 24.18.1 engine. Separate, fresh R24 Electron processes generated isolated
QA keys, saved the encrypted dual-key backup plus independent credential,
terminated, and restored both keys in a new process. Both public keys matched
the separately saved original, and restored keys completed real dual signing
and verification through the frozen portable provider. A late export after
retirement was refused. No existing Wallet profile, real account or funds were
used. These checks do not establish chain registration or migration.

Reproduction with a supplied exact provider and the intended Electron runtime:

```sh
ELECTRON_RUN_AS_NODE=1 "$ELECTRON_BINARY" scripts/qa-pq-wallet-recovery.mjs generate "$NEW_PRIVATE_QA_DIRECTORY"
ELECTRON_RUN_AS_NODE=1 "$ELECTRON_BINARY" scripts/qa-pq-wallet-recovery.mjs restore "$NEW_PRIVATE_QA_DIRECTORY"
```

Use a fresh private directory. The script writes generated QA recovery secrets
with mode 0600 and prints only non-secret result flags. Do not collect its
credential or backup as public review artifacts. Browser/mobile support, App
normal-caller adoption, authenticated chain registration, trusted migration,
policy activation and public-network upgrade remain separate gates.
