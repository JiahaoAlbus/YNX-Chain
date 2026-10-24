# Normal Wallet/Auth dependency materialization

The minimum Auth/WalletConnect runtime union is not a full App dependency image. The Auth28 failure demonstrated why: its selected dependency rows omitted 53 `@noble/ciphers@2.2.0` files required by the unchanged original App316 source-owned packaging manifest. An unchanged lock graph did not establish file coverage.

Future full normal supplies must use this owning entry instead of cloning only dependency rows selected by an older runtime union:

```
node packages/wallet-auth/scripts/build-contract-relay-runtime-manifest.mjs --materialize-normal-runtime /absolute/request.json REQUEST_BYTES REQUEST_SHA256
```

The exact request has four fields:

- `sourcePackageRoot`: a canonical private source package with the exact installed dependencies. The old deficient Auth28 prefix is intentionally rejected as a source.
- `newOutputRoot`: a new, absent destination whose canonical parent already exists. Never select a frozen prefix or an existing account/application directory.
- `runtimeUnionRef`: `{path, bytes, sha256}` for the exact normal runtime union to select. The current schema is `YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1`.
- `sourceOwnedAppManifestRef`: `{path, bytes, sha256}` for this source package's own `integration/WALLET_APP_RUNTIME_DEPENDENCIES_316.json`. Its original Main316 identity is fixed at 52657 bytes / `403467d07349bbaddab122f9e6e5ca600c2df5965ee96013fc5c5ab94d345106`; an alternate or weakened manifest is refused.

`materializeNormalRuntimeDependencies(request)` in `normal-runtime-materialization.mjs` selects the union's dependency files plus all App316 exact pins. It checks the real source before creating the destination, writes exclusive regular files and checks actual destination bytes. Missing files, changed bytes, aliases and symbolic links fail closed. A partial destination is retained on failure, never overwritten, cleaned or retried automatically. Ordinary regular copies are explicit; no copy-on-write or physical allocation guarantee is claimed.

`verifyNormalRuntimeAppCoverage(packageRoot)` is the same file coverage gate for a materialized package root. It performs no Node provider execution, Native compilation, signer call, network operation, SQL migration or account access. A valid file receipt does not grant issuer, Source, registration or App installation qualification.

The destination initially contains dependencies only (`packagePayloadMaterialized:false`). The original normal producer must separately stage the exact matching SDK payload, generate/read back its version-specific Auth/WalletConnect/union manifests, and record the App candidate. It must preserve every original frozen package and UNKNOWN outcome. New source or schema requires its own recorded inputs and evidence; old Auth28 or Auth29 results cannot qualify Auth30.

The default command without `--materialize-normal-runtime` continues to generate only a minimum runtime union. Its output explicitly reports `fullPackageDependencyMaterialization:false` and `App316CoverageVerified:false`; it is never evidence of full materialization.
