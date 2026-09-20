# Weekly v3 shared endpoint authority — 20260920.1

## Delivered scope and trust boundary

This is a new, immutable, evidence-bound bundled consumer contract, **not an
extension of Finance's expired `1.0.0-p0.2`**. No `apps/finance/**`, Wallet/Auth,
Wallet application, production ingress, DNS, chain state, admission DB or running
service is modified. Finance adopts it only through its sole owner after separate
consumer acceptance. No registry publication or installed/runtime deployment is
claimed by this source package.

- Baseline: merged main `61a914ffaa2debbf168e74a4e6f5da00b97d8f17` (PR #146).
- Manifest: `chain-metadata/endpoint-authority/20260920.1.json`, schema `1.1.0`,
  version `1.1.0-weekly-v3.20260920.1`, 6233 bytes.
- File SHA-256: `c8eb9f641185958aaec82c6fa16764e9424ad10f47bf7435af643a2a888a07e1`.
- Payload SHA-256: `29f801933e9df4faea58531cb522cc34bfe1028628adfb88227f3d0cae1e4e73`.
- Reviewed bundle pin: `chain-metadata/endpoint-authority/current.json`.
  This file is source/release policy, **not a remotely fetched trust anchor**.
- Fixed validity: `2026-09-20T08:55:00.000Z` through, but excluding,
  `2026-09-27T08:55:00.000Z` (seven days). No client-side renewal or clock offset
  is derived from this file. A trusted, independently established current time
  is required; invalid, future or expired time fails closed.
- `sourceCommit` identifies the issuing baseline, not a claim that the new file
  already existed in that commit. The final PR's Git blob/commit and the above
  hashes bind the delivered version independently.

New canonical `rpc`, `evmRpc` are `https://rpc-testnet.ynxweb4.com`; `faucet` is
`https://faucet-testnet.ynxweb4.com`. Chain identity remains `ynx_6423-1`,
6423 / `0x1917`, YNXT. Old `rpc.ynxweb4.com` and `faucet.ynxweb4.com` remain
explicit same-chain/build compatibility metadata. Old `evm.ynxweb4.com` is
preserved but not newly verified. No automatic failover/write replay is enabled.
Mainnet has `enabled=false`, `chainId=null`, `rpc=null`; `rpc-mainnet` is only a
reserved URL, never a Testnet mapping. No Mainnet DNS/proxy request is performed.

Only RPC/evmRpc/Faucet are renewed to `VERIFIED` snapshot state. REST gateway,
Wallet/App gateways, Explorer, Indexer, Monitor and Finance product acceptance
stay `PENDING`, with no invented fresh timestamps or builds. Preserving their
locations is not permission to treat them as healthy. `VERIFIED` means the
bound observation, not seven days of promised uptime. Health failures remain
distinct from expired/untrusted authority or Wallet approval state.

## Evidence provenance

The versioned `.evidence.json` retains the existing sanitizer's eight public-DNS,
TLS-verifying GET observations from 08:53–08:54 UTC. All eight were healthy.
Both RPC aliases report `4c17f2c13a0f40f7e3ccf00a03986ec7a58b3ce3`; both Faucet
aliases report `6ac8362989cc1633c26a6468a9407d4560da77c8`. New requests were only
GET `/status` and GET `/health`; no account/funding/signing/transaction action.

The refresh is tied to the coordinator's already verified controlled deployment
receipt, SHA-256 `f207c219421babcc32ec0fd15533a127dc925e08c9d5438ae98021c4b9192454`.
Its sanitized projection preserves same-block/stable-growth, chain ID, network ID,
native REST and HTTP CORS proof plus the latest recorded RPC/Faucet builds. The
fresh observed builds must match that controlled deployment. Historical finality,
multi-region stability and private service availability are not inferred. The
proofs are repository-reviewed evidence, not signed remote attestations.

## Consumer handoff and API

Files supplied to Finance without changing its paths:

- `chain-metadata/endpoint-authority/schema.json` (JSON Schema 2020-12).
- Immutable manifest/evidence above, plus independent `current.json` release pin.
- `consumer-vectors.json`: valid, expired, future, tampered, wrong-chain,
  unsigned-remote, client-renewal, Mainnet mapping, fallback and product-promotion
  failure vectors. The executable tests cover additional issuer/crypto failures.
- `sdk/js/endpoint-authority.js`: dependency-free semantic validator and selector.

`canonicalEndpointAuthorityPayload(manifest)` returns UTF-8-ready JSON with all
object keys recursively sorted, arrays unchanged, and **only the top-level
`integrity` omitted**. No trailing newline is part of the payload. Full file hashes
are separate and include the final newline. This differs intentionally from the
old insertion-order `JSON.stringify` canonicalization: consumers must migrate
the schema and pin together, not merely replace the old digest.

```js
import {validateEndpointAuthority, selectAuthorityEndpoint}
  from './endpoint-authority.js';
// REVIEWED_PIN is packaged release policy, never manifest.integrity itself.
const verified = await validateEndpointAuthority(manifest, {
  trustedPin: REVIEWED_PIN, nowMs: trustedNowMs, source: 'bundled',
  // Optional on native runtimes without WebCrypto:
  // digestSHA256: async utf8Text => securelyComputedLowercaseHexDigest
});
const rpc = selectAuthorityEndpoint(verified, 'rpc', {nowMs: trustedNowMs});
```

WebCrypto is the default. A native digest adapter is trusted implementation code,
not an untrusted callback from the manifest. No digest implementation means
failure, not skip. The verifier snapshots data and the pin before awaiting crypto;
returns a deeply frozen, verification-branded object. Selection rechecks expiry,
accepts only a verified object and only RPC/evmRpc/Faucet. An unsigned remote
replacement is always rejected, even with a matching hash or a claimed signer.
Remote signing key ID/signature remain null and `failClosed=true`.

The existing SDK `getTestnetEndpoints('active')` now uses the generated, immutable
bundle and checks its validity on every call; `'legacy'` is explicit compatibility
selection and also expires. It remains synchronous for API compatibility, relying
on the release gate's exact-byte hash check rather than accepting caller JSON.
`verifyBundledEndpointAuthority()` provides full runtime crypto verification.
`testnetEndpointProfiles` and `ynxTestnet` remain frozen configuration/discovery
metadata, not authorization to bypass expiry; ChainList's old entries are retained.
The generated `configs/testnet-endpoints.json` carries the authority version/hash/
validity and new active RPC/Faucet flags. Private/gRPC/Explorer locations are not
newly authorized. SDK archives now include both authority modules and validate
them in deterministic packaging/clean-consumer tests.

## Reproduction, issuance and rollback

```sh
make testnet-endpoint-config-check testnet-endpoint-migration-check
bash scripts/verify/sdk-check.sh
go test -race -count=1 ./internal/faucet ./cmd/ynx-faucetd
```

The config gate checks current expiry; offline tests use explicit fixture times
so historical test validity is not mistaken for current authority validity.
`generate-endpoint-authority-bundle.mjs --check` reproduces the immutable payload
from hash-bound proof without renewing it. `--write` only regenerates compiled
assets from that same reviewed version. All issuance input fields and evidence
must be explicitly supplied to `issue-endpoint-authority.mjs`; it uses exclusive
creation and cannot overwrite an existing version. A future issuer must obtain
fresh bounded evidence, review any changed predecessor build, create a **new**
version, review/update the separate pin, regenerate, test, and get owner review.
No consumer or automatic scheduler performs this procedure.

Rollback does not restore an expired authority into accepted state. Stop adopting
the new consumer package or revert this scoped PR; consumers must remain blocked
if the previous version has expired. If a usable rollback is needed, issue a
separately reviewed new version from valid evidence. Preserve all immutable
manifests/evidence and all chain/admission state. No server restart, DNS change,
production rollback or credential access is needed for this source-only package.
