# Original Shop task runtime

`commerce.OpenOriginalShopTaskOrdersSDKResult` is the normal producer matching
Auth's registered Shop client. It installs the actual SDK request/result codec
through `OpenOriginalShopTaskOrdersSDK` and `OpenOriginalShopTaskOrders`. The latter calls
the unchanged Auth zero-input factory, checks its current protected profile,
and binds that actual verifier to the original Shop reader. The service owner
keeps the returned composition through serving, drains requests, then calls
`Close`. Partial startup ownership is retired/closed on every failure.

The supplied Auth release-selection table is empty. Normal startup therefore
returns `GRANT_PROTECTED_SOURCE_NOT_SUPPLIED`; no Source, peer, issuer, key or
approval is selected from environment variables or HTTP input. The original
outer-channel Source and held response-operation authority remain mandatory.

Inside the original order lock, Shop converts only the selected original
projection values to the SDK's string DATA types. The unchanged SDK E5 encoder
checks the original Source ref/rev/label, exact fields and canonical SourceBytes
against the protected declared binding. A mismatch stops before response
encoding/attestation. Both the attestation callback and final response must
retain those exact frozen bytes. SDK `DataOnly` flags never establish a Source
or verified receipt; they carry no operation proof.

The formal relative modules and original Core14 files are pinned in
`normal-task-runtime-suppliers.json`. Go 1.26.10 and the resolved dependency
changes come from the SDK's actual normal composition. No supplier crypto or
policy implementation was modified. The main CI reads the root Go version and
its existing `make test` includes the new commerce regressions.

`PrepareOriginalShopTaskOrderSDKCodec` now installs the actual SDK request
decoder and original outer-channel checker. `OpenOriginalShopTaskOrdersSDK`
joins that codec to the original native factory. The thin DATA mapping retains
all exact E21/E3 binding/proof/input operands and owns copied bytes. The network
decoder requires the exact LINK-sealed original request before invoking the
Source's current outer-carrier mapping. It never writes a TLS exporter into the
signed inner holder/session channel. The normal result producer supplies the
concrete `originalShopSDKResultEncoder`; it cannot bypass the original attester.

Current normal dependency graph is independently read back at the original
SDK install receipt `normal-go-runtime-integration-v5-20261031/LIVE_INSTALL_RESULT.json`.
The same-byte Shop intake preserved this product's Go module graph and source.
New tests exercise real SDK request grammar/mapping, invalid media/target/kind/
carrier, unsealed TLS denial and full bootstrap refusal with the actual empty
original Source. They do not claim a native TLS product execution or admitted
response proof.

The original held response authority now receives two additional detached byte
operands on `OriginalShopTaskOrderResponse`: exact SDK `ResponseOriginal`,
`SourceBytes` and the SDK's complete `ResponseBinding` from this locked read.
The latter binds the result bytes, never the tool input. They travel with the original binding,
protected operation/remote ref, projection, Source and fence. The receipt owner
must validate/retain those bytes under that same operation, then expose them
only through its actual verified-result/history API. It must not infer a model
result by parsing an opaque `original` object or serialize a new projection.

The final encoder must also return byte-identical `ResponseOriginal` and
`SourceBytes` on `OriginalShopTaskOrderEncoding`. Missing, altered or aliased
post-attestation bytes suppress HTTP output.

Auth supplier `grant-result-source` freezes the actual registered contract:
`Client.verifyReceivedResource` decodes the HTTP Body directly with the sole SDK
`DecodeShopOrderReadResponseDATA`, then invokes its original protected
`VerifyOriginalResponse` for the same reserved operation/call/peer/Source/result.
The Shop result encoder therefore returns the exact SDK `ResponseOriginal` as
Body, with the registered `egress-only-read-fence`. It creates no extra JSON
proof envelope, operation header or alternative WIRE. Before returning, it MUST
invoke the original attester exactly once and require its complete original
proof. The held receipt owner must retain the protected binding/operation/
remote/byte association; signing unscoped DATA alone is insufficient. That
proof is not serialized into a new product format. The receiving Auth Source
independently verifies the original receipt, then exposes the verified original
bytes through `TaskResourceResult` and its independently authorized history
query. No SDK DATA flag or HTTP200 substitutes for that verification.

The frozen supplier specification is
`/Volumes/西部数据/YNX-large-work/auth-owned-r258/grant-result-source/HANDOFF.json`,
SHA256 `df810a34e961e5b902a2a3feb31c7c5ecd2a0a05e4dc7c62ed64defcb3aa4526`.
The concrete final SDK encoder is supplied locally; the protected Source,
operation-attestation and history admissions remain external runtime gates.
Shop creates no receipt DB/history endpoint and never re-dispatches UNKNOWN.
