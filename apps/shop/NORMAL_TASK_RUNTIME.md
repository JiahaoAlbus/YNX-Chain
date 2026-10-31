# Original Shop task runtime

`commerce.OpenOriginalShopTaskOrders` is the normal Go startup entry. It calls
the unchanged Auth zero-input factory, checks its current protected profile,
and binds that actual verifier to the original Shop reader. The service owner
keeps the returned composition through serving, drains requests, then calls
`Close`. Partial startup ownership is retired/closed on every failure.

The supplied Auth release-selection table is empty. Normal startup therefore
returns `GRANT_PROTECTED_SOURCE_NOT_SUPPLIED`; no Source, peer, issuer, key or
approval is selected from environment variables or HTTP input. The SDK final
response codec and original response-operation authority are still mandatory.

Inside the original order lock, Shop converts only the selected original
projection values to the SDK's string DATA types. The unchanged SDK E5 encoder
checks the original Source ref/rev/label, exact fields and canonical SourceBytes
against the protected declared binding. A mismatch stops before response
encoding/attestation. Both the attestation callback and final envelope must
return those exact frozen bytes. SDK `DataOnly` output is never served as an
attested tool result or admitted Source; it carries no operation proof.

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
signed inner holder/session channel. The external final-frame encoder remains
mandatory; the DATA-only encoder cannot fill that role automatically.

Current normal dependency graph is independently read back at the original
SDK install receipt `normal-go-runtime-integration-v5-20261031/LIVE_INSTALL_RESULT.json`.
The same-byte Shop intake preserved this product's Go module graph and source.
New tests exercise real SDK request grammar/mapping, invalid media/target/kind/
carrier, unsealed TLS denial and full bootstrap refusal with the actual empty
original Source. They do not claim a native TLS product execution or admitted
response proof.
