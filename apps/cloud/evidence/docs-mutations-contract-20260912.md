# Docs core mutation contract

Implemented routes extend v2 create/read/save. All require a fresh proof. Web
mutations also require the exact Origin header; missing Origin returns
403 {"error":"ORIGIN_REQUIRED","code":"ORIGIN_REQUIRED"} before proof consumption.

| Route | Ordered Docs scopes | Input | Success |
| --- | --- | --- | --- |
| PATCH /api/v1/objects/{id} | docs.write, files.write | {name?:string,parentId?:string} | 200 Object |
| GET /api/v1/objects/{id}/versions | docs.read, files.read | none | 200 existing Version array |
| POST /api/v1/objects/{id}/trash | docs.write, files.write | empty body | 200 Object |
| POST /api/v1/objects/{id}/restore | docs.write, files.write | empty body | 200 Object |
| POST /api/v1/objects/{id}/versions/{version}/restore | docs.write, files.write | empty body | 200 Object |

Every mutation uses the same durable Idempotency-Key contract as create/save,
including same exact bytes on retry, a new proof each attempt, conflicts on a
different request, and no blind retry of uncertain outcomes. Empty-body requests
must remain empty on retries; changing to {} changes the request digest.

PATCH accepts one or both fields. Name changes require editor access. Moves
require ownership, a same-product/same-owner non-trashed folder or empty parentId
for root. Cyclic or corrupted ancestry is rejected. A no-op returns the existing
Object without a new update. Original schema7 metadata is retained.

Docs folder creation is now accepted alongside Docs documents. Create rejects a
parent belonging to a different product. Existing implicit untagged folder
migration has not been redefined here; old snapshot compatibility requires a
separate cold-load and product-lineage check.

Existing business errors retain their handler representation. Version restoration
uses the existing RestoreVersion implementation; it does not accept a client
baseVersion in this route. Document saving still uses baseVersion and returns 409
current on conflict. Product access is checked before mutations and before
idempotent response replay. Unauthorized proofs never fall back to bearer auth.

Local tests exercise actual folder/document creation, rename/move boundaries,
document save/version conflict and schema7 service reopening, plus v2 Origin and
authorization failures and durable retry receipts. They do not establish full
legacy Docs parity or a public Wallet-authorized CRUD round trip. Duplicate,
threaded comments/resolution, presence and AI v2 contracts are not enabled by this
candidate and must not be simulated by the client.
