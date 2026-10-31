# Deployment V2 DATA contract — authority boundaries

This new profile does not extend or reinterpret the deployed six-field manifest.
The old manifest has exactly `projectId, version, contentDigest, publishPurpose,
targetEnvironment, byteSize`; contentDigest remains SHA-256 and its signature
invocation remains the complete original manifest. Its original publication
purpose is ARTIFACT-RELEASE and its original Source decides publisher currentness,
project access, confirmation/revocation, and resource approval.

Read-only provenance: original Cloud owner 20-cloud at HEAD
806b657fc60d88bf6dc7fbc8f9125a2ba9c02d54 plus its preserved owned overlay:
`internal/cloud/ide_deployment_artifact.go`,
`internal/cloud/ide_deployment.go`, `internal/cloud/ide_deployment_transition.go`,
`internal/cloud/object_versions.go`, `apps/cloud/client/deployment-client.mjs`,
`internal/developerauthority/publication.go`,
`internal/developerauthority/original_ide_source_publication.go`.

P04 logical FileObj is `{ref,content,size,mime,objectKey}` and Manifest is
`{project,version,artifact,env,publisher,binding}`. Ref is complete
`{realm,tenant,kind,id,rev}` and Bind is
`{bytes,sha3_512,sha512}`. Logical fields do not alone determine physical byte
encoding, signing domain, issuer/subject epochs, generation, or Bind preimages.
No missing physical semantics may be inferred from a URL or old artifact digest.

Actual-byte Bind is E(U64BE byte length, raw SHA3-512[64], raw SHA-512[64]).
Constructor hashing uses a single detached capture, never user iterators,
own buffer accessors, SharedArrayBuffer, detached arrays, or Proxy data.
Digest text is lower-case hex128, U64 is canonical decimal. Actual artifact byte
budget follows original caller maximum 64 MiB, control WIRE is at most 1 MiB.
Go uses standard crypto/sha3 and therefore requires Go >=1.24 for this module;
the parent-owned go.mod is deliberately unchanged.

Normal old submit binds original request, old manifest SHA256, approval SHA256,
actual-content dual Bind, selected expected slot revision and optional old
request rollback target. A rollback is a NEW forward deployment, not restoring
ledger, authorization, budget, billing state or an old approval. Currentness,
CAS/resource fence, publisher signature, original Source and actual runtime
readback remain original-owner work. UNKNOWN reconciles the original operation.

DATA construction/decoding never establishes signature verification, Source
admission, publisher registration/currentness, allocation, deployment, business
readiness, usage settlement or rollback success. Those statuses remain false.

Policy applied to actual /root/open02_codec: core-first and old-website freeze;
this module does not resume Cloud service/UI/website/download development.

## New decision and concrete API

The initial missing semantics above were subsequently resolved by parent `/root`
as sole OPEN writer under the current Root's specific V5 SDK authorization.
The machine contract is `deployment-v2.json`; no historical V2 is claimed.
No source/gen/slot fields are invented. Domain is
`YNX-CLOUD-DEPLOYMENT-MANIFEST/v2`; the exact ten-key DTO becomes E11 including
its domain. `publisher` is the signature subject and `publisherEpoch` its
explicit epoch. Neither publisherEpoch nor issuerEpoch is inferred from Ref.rev.
Issuer is an explicitly selected fullRef, including when its realm/tenant differ.
The constructor's content must match actual held artifact bytes. The outer Bind
covers the exact signed payload, not JSON or an object containing its own Bind.

JS ports (Go equivalents use the same capitalized names):

- `createDeploymentManifestV2DATA(dto, actualArtifact)` ->
  `{payloadOriginal: Uint8Array, binding: DeploymentV2Bind}`.
- `decodeDeploymentManifestV2DATA(payloadOriginal, expectedFullBinding?)` ->
  exact ten-key DTO. With no expected binding this only checks DATA syntax and
  internal consistency. Same-shaped swaps cannot establish intended selection;
  supply an independently selected full binding for that check.
- `assertDeploymentArtifactV2DATA(payloadOriginal, actualArtifact)` -> checked
  artifact content Bind. It does not check publisher signature/currentness.

Go decoder's second parameter is `*DeploymentV2Bind`, nil for syntax only.
Hashing/binding ports are also available for original caller DATA reconciliation.

Parent-owned package public export proposal only (not written to package.json):
`"./deployment-v2": {"types":"./src/deployment-v2.d.ts","import":"./src/deployment-v2.js"}`.
The type consumer intentionally imports this module relatively until parent
publishes that public subpath. No service or normal Source factory is replaced.

Normal integration: original Cloud caller constructs the V2 payload from its
independent selection and actual artifact, persists full Bind with the same
original operation/CAS selection, asks the actual Auth V2 signer for the exact
payloadOriginal, and checks the same full Bind and content at readback/resource
fence. The old six-field signer cannot sign V2; missing V2 signer/Source is
UNAVAILABLE. New requestId, rollback target or generation is not inferred.
Actual usage settlement remains separate; 200/readiness is not business proof.
