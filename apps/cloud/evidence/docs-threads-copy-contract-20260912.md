# Docs threads and copy

All mutations require exact Web Origin, fresh v2 proof and the existing durable
Idempotency-Key contract. These are candidate implementations, not public QA.

| Route | Ordered Docs scopes | Body | Response |
| --- | --- | --- | --- |
| GET /api/v1/objects/{id}/comments | docs.read, files.read | none | 200 comments (legacy empty result may be null) |
| POST /api/v1/objects/{id}/comments | docs.write, files.write | {version,body,mentions,parentId?,anchor?} | 201 Comment |
| POST /api/v1/objects/{id}/comments/{thread}/resolve | docs.write, files.write | {resolved:boolean} | 200 root Comment |
| POST /api/v1/objects/{id}/duplicate | docs.read, docs.write, files.read, files.write | {parentId,name?} | 201 Object |

Comment includes threadId, parentId, anchor, resolvedBy and resolvedAt where
present. Anchor is {start,end,quote}; offsets are Unicode code points, not UTF-16
code units, with exclusive end. Quote must match the chosen document version.
Replies select a parent in the same object and cannot carry another anchor.
Resolved threads reject new replies until reopened with resolved:false. Resolving
requires editor access. Existing flat comments are valid roots. Encrypted object
content cannot be used as a plaintext anchor. Metadata fields are optional so
older schema7 comment records are retained without a forced whole-store rewrite.

Copy includes the current version of visible same-product descendants, not prior
history, permissions or comments. Destination must be an owned same-product folder
or root; cyclic ancestry and oversized trees are rejected. File content must be in
hot/immediate storage. Cross-owner content is materialized into the new owner's
product storage namespace rather than borrowing their storage reference. Quota is
checked before adding metadata. A crash or persistence failure still follows the
uncertain-outcome journal contract, not an exactly-once claim.

Local HTTP tests use the actual business handlers and local storage with an
explicit fake authorization provider, not a real Wallet approval. They exercise
anchoring/reply/resolve, duplicate retry suppression, rejection after resolution,
copy metadata, no comment copying and cold reopening of thread/copy state. Full
legacy backup/observability parity, remote provider migration and public signed
user flows remain separate unfinished work.
