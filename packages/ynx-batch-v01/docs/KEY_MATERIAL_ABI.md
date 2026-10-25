# YNX-BATCH key material ABI v1

This candidate implements one private-key interchange profile for native Node
and the explicit portable Node/Electron provider. It does not implement Wallet
backup encryption, account migration, chain registration, or authorization.
Only generated test keys were used for the results below.

## Public API

```js
const pair = keyGen({provider: 'portable'}); // or 'native'; omitted means native
// pair: { privateKey: opaque handle, publicKey: {pkA, pkB}, provider: version DTO }
const material = exportKeyMaterial(pair.privateKey); // plaintext: protected process only
const restored = importKeyMaterial(material, {provider: 'portable'});
destroyKey(restored.privateKey);
destroyKey(pair.privateKey);
material.pkcs8A.fill(0);
material.pkcs8B.fill(0);
```

`exportKeyMaterial` and `importKeyMaterial` are synchronous. They accept/return
ordinary non-shared Node Buffers. Returned buffers are detached copies. An opaque
handle cannot be serialized or forged. `destroyKey` invalidates that handle for
signing and export. Keys remain scoped to the provider used when imported or
generated; a batch uses the same provider for signatures and both tree hashes.

`providerInfo({provider})` reports the actual loaded runtime/library versions.
Native requires exactly Node 26.7.0 and OpenSSL 3.6.4. Portable requires exactly
`@noble/post-quantum` 0.6.1 and `@noble/hashes` 2.2.0, checked from their resolved
installed package metadata. No runtime failure silently switches providers.
`createVerifier({provider, chainId, resolveTrustedOwner, ...})` must likewise
explicitly choose portable on Electron. No arbitrary signer/provider callback is
accepted by this API. Signing still requires the surrounding protected Wallet
authority; possession of an imported handle alone does not establish an account.

## Exact material object

| Field | Value / size |
| --- | --- |
| `format` | `YNX-BATCH/KEY-MATERIAL/v1` |
| `algorithmVersion` | `YNX-BATCH/v0.1` |
| `suite` | `ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512` |
| `pkcs8A` | Unencrypted canonical PKCS8 DER, exactly 54 bytes |
| `pkcs8B` | Unencrypted canonical PKCS8 DER, exactly 150 bytes |
| `pkA` | Raw ML-DSA-87 public key, exactly 2592 bytes |
| `pkB` | Raw SLH-DSA-SHA2-256f public key, exactly 64 bytes |

The DER profile is deliberately narrower than all valid PKCS8 variants. It
rejects alternate algorithms, extra attributes, trailing bytes, expanded ML-DSA
keys, PEM, BER, wrong lengths, and any other encoding. The non-secret fixed DER
headers are:

```text
A: 3034020100300b060960864801650304031304228020 || seed[32]
B: 308193020100300b0609608648016503040319048180 || secretKey[128]
```

A uses OID `2.16.840.1.101.3.4.3.19` and ML-DSA's seed-only `[0]` encoding.
B uses OID `2.16.840.1.101.3.4.3.25` and the SLH secret-key byte sequence
`SK.seed[32] || SK.prf[32] || PK.seed[32] || PK.root[32]`.
These public headers are encoding constants, not key material.

Native generation uses two separate standard OpenSSL KeyGen calls. Portable
generation uses separate CSPRNG requests of 32 bytes for ML-DSA and 96 bytes for
SLH (`SK.seed || SK.prf || PK.seed`), then the pinned library's standard KeyGen.
There is no caller-supplied deterministic seed, account-derived seed, network
seed, or mnemonic fallback in `keyGen`. Imported bytes cannot prove their
historical entropy source; caller policy must govern acceptable key provenance.

Both imports strictly check the profile and both expected public keys. Portable
recomputes ML-DSA from its seed and SLH's full expanded secret from its first 96
bytes, compares the entire SLH secret, then compares both public keys. Native
checks the exact types and derived public keys and performs standard sign/verify
self-checks on a fresh, module-domain random challenge. This rejects the case
where SLH's embedded public bytes are unchanged but its private seed was changed.
Import self-checks do not grant migration or account authorization.

The material's `pkA`/`pkB` are consistency expectations, not a chain registry.
Wallet recovery must additionally compare both recomputed public keys with the
original backup binding and the trusted chain registration. The SDK owns the
encrypted envelope, KDF/AEAD, version/network/account binding, protected process
transport, independent recovery credential, and clean-environment recovery.

Exported plaintext must remain in the protected signing/backup process and be
encrypted before storage or transport. It must not enter renderer state, logs,
telemetry, or an account API. Explicit JS buffers are wiped best-effort on internal
cleanup; Node KeyObjects and JS/native allocator copies have no guaranteed
immediate zeroization. Callers must also clear their exported plaintext copies.

## Hash compatibility and scope

The native tree path still uses Node `createHash('sha3-512'|'sha512')`. The
portable path explicitly uses Noble `sha3_512` and `sha512`; prefix reuse calls
their `clone()` method. Both paths absorb the complete, unchanged `E(...)` bytes.
No algorithm, context, tag, field order, tree position or message is changed.

The module still uses Node Buffer, CSPRNG, filesystem package metadata and module
resolution. It has passed an actual Electron execution below; it is **not** a
browser or mobile-ready package. A Node-free CSPRNG/byte/runtime boundary and
platform packaging remain separate work. Synchronous SLH signing should be run
inside the existing protected worker/process rather than the UI thread.

## Recorded checks, 2026-10-18

Initial raw-format probe on Node 26.7.0 / OpenSSL 3.6.4, exit 0, RSS 49,250,304 B:

| Algorithm | raw-seed | raw-private | PKCS8 DER |
| --- | --- | --- | --- |
| ML-DSA-87 | 32 B, import/export and public equality passed | Unsupported | 54 B, roundtrip passed |
| SLH-DSA-SHA2-256f | Unsupported | 128 B, roundtrip passed | 150 B, roundtrip passed |

The first real R24 run was RED before the portable hash adapter:

```text
Electron 42.10.0; Node 24.18.1; OpenSSL reported 0.0.0
5 tests: 4 pass, 1 fail; exit 1; 0.40 s wall; max RSS 83,525,632 B
Error: Digest method not supported
  at createHash (node:crypto:146:10)
  at createHasher (src/tree.mjs:14:23)
  at Module.batchSign (src/index.mjs:52:16)
```

After the explicit portable hash repair, the same executable passed 6/6 tests,
exit 0, 4.56 s wall, maximum RSS 122,191,872 B. The tests include every legal
N=1..1024 tree size in original/optimized modes, restored fresh keys, exact DER
roundtrip, complete batch AND verification, Whole/Member verification, wrong
keys/algorithms/lengths, forged handles, destruction and inconsistent SLH secret.
The executable was used only in its already-enabled RunAsNode mode. No app main,
profile, Wallet account, existing key, funding or network transaction was used.

Reproduction (one process; 128 MiB V8 old-space limit):

```sh
env -u NODE_OPTIONS -u NODE_PATH ELECTRON_RUN_AS_NODE=1 \
  '/Users/huangjiahao/.ynx-build-capacity-20261011/wallet-r24-canonical-full-matching-20261018/output/mac-arm64/YNX Wallet.app/Contents/MacOS/YNX Wallet' \
  --max-old-space-size=128 --input-type=module \
  --eval 'console.log(JSON.stringify({node:process.versions.node, electron:process.versions.electron, openssl:process.versions.openssl})); await import("./test/key-material.test.mjs");'
node --max-old-space-size=128 --test --test-concurrency=1 test/*.test.mjs
```

Working directory is this module's root. The Node 26 full suite after the hash
repair passed 28/28, exit 0, 3.85 s wall, maximum RSS 234,946,560 B. This includes
the pre-existing reference codec/trees, real standard signatures, cache/revocation
controls, NIST ACVP keyGen/sigVer controls, and the new exact native/portable
tree differentials and PKCS8 interoperability. The heap flag is not an RSS cap.
The tests are not a production backup recovery, product installation, account
migration, consensus upgrade, throughput measurement, or public-network activation.

## Primary implementation references

- [Node crypto key type / OID and raw-format table](https://nodejs.org/download/release/v26.2.0/docs/api/crypto.html#asymmetric-key-types)
- [Node private-key export formats and seed-only default](https://nodejs.org/download/release/v26.2.0/docs/api/crypto.html#keyobjectexportoptions)
- [Noble post-quantum implementation](https://github.com/paulmillr/noble-post-quantum)

The exact installed libraries and Node/OpenSSL runtime were tested locally as
recorded above. This combination has no claimed NIST validation or new security
proof; using standardized primitives does not certify this protocol or provider.
