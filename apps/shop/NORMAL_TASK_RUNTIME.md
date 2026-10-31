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
